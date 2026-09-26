/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2025 Corporation for Digital Scholarship
					Vienna, Virginia, USA
					http://zotero.org
	
	This file is part of Zotero.
	
	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
	
	***** END LICENSE BLOCK *****
*/

import { Tab, background, getExtensionURL, delay } from '../support/utils.mjs';

describe("ItemSaver", function() {
	var tab = new Tab();

	before(async function() {
		await tab.init(getExtensionURL('test/data/journalArticle-single.html'))
	});

	after(async function () {
		await tab.close();
	});

	describe('PDF response validation', function() {
		it('rejects verification HTML even when it is labelled as PDF or binary', async function() {
			let result = await background(async function() {
				let html = new TextEncoder().encode('<!DOCTYPE html><html><title>Verify access</title></html>').buffer;
				let cookies = sinon.stub(Zotero.Connector_Browser, 'getAllCookies').resolves([]);
				let request = sinon.stub(Zotero.HTTP, 'request');
				let upload = sinon.stub(Zotero.Connector, 'callMethod');
				let errors = [];
				try {
					for (let contentType of ['text/html', 'application/pdf', 'application/octet-stream']) {
						request.resolves({ status: 200, response: html,
							getResponseHeader: name => name.toLowerCase() === 'content-type'
								? contentType : String(html.byteLength) });
						try {
							await Zotero.ItemSaver.saveAttachmentToZotero({
								url: 'https://example.com/verification.pdf', mimeType: 'application/pdf',
							}, 'validation-test', { automatic: false });
							errors.push(null);
						}
						catch (e) { errors.push(e.message); }
					}
					return { errors, uploaded: upload.called };
				}
				finally {
					cookies.restore();
					request.restore();
					upload.restore();
				}
			});
			assert.isFalse(result.uploaded, 'invalid PDF bytes must not reach Desktop');
			assert.lengthOf(result.errors, 3);
			for (let error of result.errors) assert.match(error, /Attachment download failed/);
		});

		it('accepts PDF headers with a leading byte prefix and leaves other formats alone', async function() {
			let result = await background(function() {
				return [
					['%PDF-1.7\n', 'application/pdf', 'application/pdf'],
					['\uFEFF \r\n%PDF-2.0\n', 'application/pdf', 'application/octet-stream'],
					['%PDF-1.7\n', undefined, 'application/pdf'],
					['PK\x03\x04', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'],
				].map(([body, mimeType, contentType]) => Zotero.ItemSaver._validateResponse({ mimeType }, {
					response: new TextEncoder().encode(body).buffer,
					getResponseHeader: name => name.toLowerCase() === 'content-type' ? contentType : null,
				}, contentType));
			});
			assert.deepEqual(result, [null, null, null, null]);
		});

		it('validates inferred PDFs and empty bodies without a Content-Length header', async function() {
			let errors = await background(function() {
				return ['', '<html>Access denied</html>'].map(body => Zotero.ItemSaver._validateResponse({
					url: 'https://example.com/download.pdf',
				}, {
					response: new TextEncoder().encode(body).buffer,
					getResponseHeader: () => null,
				}, 'application/octet-stream'));
			});
			assert.deepEqual(errors, ['response is not a PDF', 'response is not a PDF']);
		});
	});

	describe('individual attachment failures', function() {
		it('finishes failed SI PDFs while keeping successful files and continuing the save', async function() {
			let result = await tab.run(async function() {
				let sandbox = sinon.createSandbox();
				try {
					sandbox.stub(Zotero.Connector, 'getPref').resolves(true);
					let saved = [];
					sandbox.stub(Zotero.ItemSaver, 'saveAttachmentToZotero').callsFake(async attachment => {
						if (attachment.id === 'failed-si') throw new Error('publisher rejected SI');
						saved.push(attachment.id);
					});
					let results = [];
					// Cover failure both before and after the successful primary PDF.
					for (let ids of [['main', 'failed-si', 'good-si'], ['failed-si', 'main', 'good-si']]) {
						let saver = new Zotero.ItemSaver({ sessionID: 'failure-isolation' });
						sandbox.stub(saver, '_loadAutomaticAttachmentPolicy').resolves();
						let resolver = sandbox.stub(saver, 'saveAttachmentFromResolver').resolves();
						saver._items = [{ id: 'parent', title: 'Preserved metadata',
							attachments: ids.map(id => ({ id, url: `https://example.com/${id}.pdf`, mimeType: 'application/pdf' })) }];
						let progress = {};
						await saver._saveAttachmentsToZotero((attachment, status) => { progress[attachment.id] = status; });
						results.push({ progress, resolverCalled: resolver.called, title: saver._items[0].title });
					}
					return { results, saved };
				}
				finally { sandbox.restore(); }
			});
			assert.deepEqual(result.saved, ['main', 'good-si', 'main', 'good-si']);
			for (let run of result.results) {
				assert.deepEqual(run.progress, { main: 100, 'failed-si': false, 'good-si': 100 });
				assert.isFalse(run.resolverCalled);
				assert.equal(run.title, 'Preserved metadata');
			}
		});

		it('retains the primary resolver retry and finalizes other failed PDFs', async function() {
			let result = await tab.run(async function() {
				let sandbox = sinon.createSandbox();
				try {
					sandbox.stub(Zotero.Connector, 'getPref').resolves(true);
					sandbox.stub(Zotero.ItemSaver, 'saveAttachmentToZotero').rejects(new Error('publisher rejected file'));
					let saver = new Zotero.ItemSaver({ sessionID: 'resolver-isolation' });
					sandbox.stub(saver, '_loadAutomaticAttachmentPolicy').resolves();
					let resolver = sandbox.stub(saver, 'saveAttachmentFromResolver').callsFake(async (item, callback) => {
						callback(item.attachments[0], 100);
					});
					saver._items = [{ id: 'parent', attachments: ['main', 'failed-si'].map(id => ({
						id, url: `https://example.com/${id}.pdf`, mimeType: 'application/pdf',
					})) }];
					let progress = {};
					await saver._saveAttachmentsToZotero((attachment, status) => { progress[attachment.id] = status; });
					return { progress, resolverCalls: resolver.callCount };
				}
				finally { sandbox.restore(); }
			});
			assert.deepEqual(result, { progress: { main: 100, 'failed-si': false }, resolverCalls: 1 });
		});
	});

	describe('_executeSingleFile', function() {
		it('sets data.url to item.url when item has url defined', async function() {
			const testUrl = 'https://example.com/test-article';

			const capturedData = await tab.run(async function (testUrl) {
				try {
					const ItemSaver = Zotero.ItemSaver;
					let capturedData = null;

					// Stub the required functions
					sinon.stub(Zotero.SingleFile, "retrievePageData").resolves("test content");
					sinon.stub(Zotero.Connector, "saveSingleFile").callsFake(async (options, data) => {
						capturedData = data;
					});

					// Create ItemSaver instance with test data
					const itemSaver = new ItemSaver({
						sessionID: 'test-session',
					});

					// Set up test data
					itemSaver._items = [{
						url: testUrl,
					}];
					itemSaver._snapshotAttachment = {
						title: 'Test Snapshot',
					};
					itemSaver._sessionID = 'test-session';

					await itemSaver._executeSingleFile(() => 0);

					return capturedData;
				}
				finally {
					Zotero.SingleFile.retrievePageData.restore();
					Zotero.Connector.saveSingleFile.restore();
				}
			}, testUrl);

			// Verify data.url is set to item.url
			assert.isNotNull(capturedData);
			assert.equal(capturedData.url, testUrl);
		});

		it('sets data.url to document.location.href when item has no url defined', async function() {
			const documentUrl = getExtensionURL('test/data/journalArticle-single.html');
			const capturedData = await tab.run(async function () {
				try {
					const ItemSaver = Zotero.ItemSaver;
					let capturedData = null;

					// Stub the required functions
					sinon.stub(Zotero.SingleFile, "retrievePageData").resolves("test content");
					sinon.stub(Zotero.Connector, "saveSingleFile").callsFake(async (options, data) => {
						capturedData = data;
					});

					// Create ItemSaver instance with test data
					const itemSaver = new ItemSaver({
						sessionID: 'test-session',
					});

					// Set up test data
					itemSaver._items = [{
						// No url
					}];
					itemSaver._snapshotAttachment = {
						title: 'Test Snapshot',
					};
					itemSaver._sessionID = 'test-session';

					await itemSaver._executeSingleFile(() => 0);

					return capturedData;
				}
				finally {
					Zotero.SingleFile.retrievePageData.restore();
					Zotero.Connector.saveSingleFile.restore();
				}
			});

			// Verify data.url is set to document.location.href
			assert.isNotNull(capturedData);
			assert.equal(capturedData.url, documentUrl);
		});
	});

	describe('automatic attachment policy', function() {
		it('preserves the sender tab when policy options are sent through messaging', async function() {
			await background(function() {
				Zotero._policyTestTabID = null;
				sinon.stub(Zotero.ItemSaver, '_fetchAttachment').callsFake(async (attachment, tab) => {
					Zotero._policyTestTabID = tab?.id;
					return new ArrayBuffer(1);
				});
				sinon.stub(Zotero.Connector, 'callMethod').resolves(true);
			});
			try {
				await tab.run(async function() {
					return Zotero.ItemSaver.saveAttachmentToZotero({
						url: 'https://example.com/file.bin',
						mimeType: 'application/octet-stream',
						title: 'File',
					}, 'session', { automatic: false });
				});
				let capturedTabID = await background(function() {
					return Zotero._policyTestTabID;
				});
				let expectedTabID = tab.tabId;
				assert.equal(capturedTabID, expectedTabID);
			}
			finally {
				await background(function() {
					Zotero.ItemSaver._fetchAttachment.restore();
					Zotero.Connector.callMethod.restore();
					delete Zotero._policyTestTabID;
				});
			}
		});

		it('loads the Desktop policy through the injected messaging context', async function() {
			let policy = {
				version: 1,
				types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
				genericMIMETypes: ['application/octet-stream'],
				enabled: { pdf: false },
			};
			try {
				await background(function(policy) {
					Zotero.Connector._processAutomaticAttachmentDownloads(policy);
				}, policy);
				let disabled = await tab.run(async function() {
					let saver = new Zotero.ItemSaver({ automatic: true });
					await saver._loadAutomaticAttachmentPolicy();
					return [
						saver._automaticAttachmentPolicy.enabled.pdf,
						saver._shouldDownloadAttachment({ mimeType: 'application/pdf' }),
						saver._shouldDownloadAttachment({ mimeType: 'application/pdf' }, { force: true }),
					];
				});

				policy.enabled.pdf = true;
				await background(function(policy) {
					Zotero.Connector._processAutomaticAttachmentDownloads(policy);
				}, policy);
				let enabled = await tab.run(async function() {
					let saver = new Zotero.ItemSaver({ automatic: true });
					await saver._loadAutomaticAttachmentPolicy();
					return [
						saver._automaticAttachmentPolicy.enabled.pdf,
						saver._shouldDownloadAttachment({ mimeType: 'application/pdf' }),
					];
				});

				await background(function() {
					Zotero.Connector._clearAutomaticAttachmentDownloads();
				});
				let disconnected = await tab.run(async function() {
					let saver = new Zotero.ItemSaver({ automatic: true });
					await saver._loadAutomaticAttachmentPolicy();
					return [saver._automaticAttachmentPolicy, saver._shouldDownloadAttachment({ mimeType: 'application/pdf' })];
				});
				assert.deepEqual(disabled, [false, false, true]);
				assert.deepEqual(enabled, [true, true]);
				assert.deepEqual(disconnected, [null, true]);
			}
			finally {
				await background(function() {
					Zotero.Connector._clearAutomaticAttachmentDownloads();
				});
			}
		});

		it('blocks before fetching and rechecks the response MIME type', async function() {
			let result = await background(async function() {
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'],
					enabled: { pdf: false },
				});
				let fetch = sinon.stub(Zotero.ItemSaver, '_fetchAttachment').callsFake(async attachment => {
					attachment.mimeType = 'application/pdf';
					return new ArrayBuffer(1);
				});
				let callMethod = sinon.stub(Zotero.Connector, 'callMethod');
				try {
					let blockedBeforeFetch = await Zotero.ItemSaver.saveAttachmentToZotero({
						url: 'https://example.com/file.pdf',
						filename: 'file.pdf',
						mimeType: 'application/pdf',
						title: 'File',
					}, 'session');
					let prefetchCalls = [fetch.called, callMethod.called];
					fetch.resetHistory();
					callMethod.resetHistory();
					let blockedAfterFetch = await Zotero.ItemSaver.saveAttachmentToZotero({
						url: 'https://example.com/file',
						filename: 'file',
						mimeType: 'application/octet-stream',
						title: 'File',
					}, 'session');
					return [blockedBeforeFetch, prefetchCalls, blockedAfterFetch, fetch.called, callMethod.called];
				}
				finally {
					fetch.restore();
					callMethod.restore();
					Zotero.Connector._clearAutomaticAttachmentDownloads();
				}
			}, tab.tabId);
			assert.deepEqual(result, [
				{ skipped: true, reason: 'automatic-download-disabled' },
				[false, false],
				{ skipped: true, reason: 'automatic-download-disabled' },
				true,
				false,
			]);
		});

		it('keeps an explicit server save available while automatic acquisition is disabled', async function() {
			let result = await background(async function() {
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'],
					enabled: { pdf: false },
				});
				let create = sinon.stub(Zotero.ItemSaver, '_createServerAttachmentItem').resolves('KEY');
				let fetch = sinon.stub(Zotero.ItemSaver, '_fetchAttachment').resolves(new ArrayBuffer(1));
				let upload = sinon.stub(Zotero.API, 'uploadAttachment').resolves();
				try {
					let attachment = {
						url: 'https://example.com/file.pdf',
						mimeType: 'application/pdf',
						linkMode: 'imported_url',
						title: 'File',
					};
					await Zotero.ItemSaver.saveAttachmentToServer(attachment);
					return [create.called, fetch.called, upload.called];
				}
				finally {
					create.restore();
					fetch.restore();
					upload.restore();
					Zotero.Connector._clearAutomaticAttachmentDownloads();
				}
			}, tab.tabId);
			assert.deepEqual(result, [true, true, true]);
		});

		it('preserves disabled PDF URL links without fetching or uploading them', async function() {
			await background(async function() {
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'],
					enabled: { pdf: false },
				});
				Zotero._linkPolicyCreate = sinon.stub(Zotero.ItemSaver, '_createServerAttachmentItem').resolves('KEY');
				Zotero._linkPolicyFetch = sinon.stub(Zotero.ItemSaver, '_fetchAttachment').resolves(new ArrayBuffer(1));
				Zotero._linkPolicyUpload = sinon.stub(Zotero.API, 'uploadAttachment').resolves();
			});
			try {
				let result = await tab.run(async function() {
					let callback = sinon.stub();
					let saver = new Zotero.ItemSaver({ automatic: true });
					await saver._loadAutomaticAttachmentPolicy();
					await saver._saveAttachmentsToServer('PARENT', 'File', [{
						url: 'https://example.com/file.pdf',
						mimeType: 'application/pdf',
						snapshot: false,
						title: 'Linked PDF',
					}], { automaticSnapshots: true, downloadAssociatedFiles: true }, callback);
					return callback.lastCall.args[1];
				});
				let calls = await background(function() {
					return [Zotero._linkPolicyCreate.called, Zotero._linkPolicyFetch.called,
						Zotero._linkPolicyUpload.called];
				});
				assert.deepEqual([calls, result], [[true, false, false], 100]);
			}
			finally {
				await background(function() {
					Zotero._linkPolicyCreate.restore();
					Zotero._linkPolicyFetch.restore();
					Zotero._linkPolicyUpload.restore();
					delete Zotero._linkPolicyCreate;
					delete Zotero._linkPolicyFetch;
					delete Zotero._linkPolicyUpload;
					Zotero.Connector._clearAutomaticAttachmentDownloads();
				});
			}
		});
	});
});
