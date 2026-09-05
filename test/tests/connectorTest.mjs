/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2017 Center for History and New Media
					George Mason University, Fairfax, Virginia, USA
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

import { background, offscreen } from '../support/utils.mjs';

describe('Connector', function() {
	describe('#checkIsOnline()', function() {
		before(function() {
			return background(function() {
				sinon.stub(Zotero.HTTP, 'request');
			});
		});
		
		after(function() {
			return background(function() {
				Zotero.HTTP.request.restore();
			});
		});
	
		it('returns true when Zotero is online', async function() {
			let status = await background(function() {
				Zotero.HTTP.request.resolves({status: 200, getResponseHeader: () => 'application/json', responseText: '{}'});
				return Zotero.Connector.checkIsOnline();
			});
			assert.isOk(status);
		});
		
		it('returns false when Zotero is offline', async function() {
			let status = await background(function() {
				Zotero.HTTP.request.throws(new Zotero.HTTP.StatusError({status: 0}));
				return Zotero.Connector.checkIsOnline();
			});
			assert.isNotOk(status);
		});

		it('clears desktop translator preferences when the ping fails', async function() {
			let prefs = await background(async function() {
				Zotero.Connector._processTranslatorPreferences({
					translatorPrefsVersion: 1,
					translatorPrefs: { attachSupplementary: true }
				});
				Zotero.HTTP.request.throws(new Zotero.HTTP.StatusError({status: 0}));
				await Zotero.Connector.checkIsOnline();
				return Zotero.Prefs.getAll();
			});
			assert.notProperty(prefs, 'translators.attachSupplementary');
		});
		
		it('returns true if Zotero responds with a non-200 status', async function () {
			let result = await background(async function() {
				Zotero.HTTP.request.resolves({status: 500, getResponseHeader: () => '', responseText: 'Error'});
				try {
					return await Zotero.Connector.checkIsOnline();
				} catch (e) {
					return false;
				}
			});
			assert.isTrue(result);
		});
	});

	describe('translator preferences', function() {
		afterEach(async function() {
			await background(async function() {
				Zotero.Connector._processTranslatorPreferences();
				await Zotero.Prefs.clear([
					'translators.attachSupplementary',
					'translators.supplementaryAsLink'
				]);
			});
		});

		it('uses connected Zotero translator preferences as runtime overrides', async function() {
			let values = await background(async function() {
				await Zotero.Prefs.set('translators.attachSupplementary', false);
				Zotero.Connector._processPreferences({
					translatorPrefsVersion: 1,
					translatorPrefs: {
						attachSupplementary: true,
						supplementaryAsLink: true
					}
				});
				return [
					Zotero.Prefs.get('translators.attachSupplementary'),
					Zotero.Prefs.get('translators.supplementaryAsLink')
				];
			});
			assert.deepEqual(values, [true, true]);
		});

		it('restores Connector-local preferences when desktop overrides are cleared', async function() {
			let value = await background(async function() {
				await Zotero.Prefs.set('translators.attachSupplementary', true);
				Zotero.Connector._processTranslatorPreferences({
					translatorPrefsVersion: 1,
					translatorPrefs: { attachSupplementary: false }
				});
				Zotero.Connector._processTranslatorPreferences();
				return Zotero.Prefs.get('translators.attachSupplementary');
			});
			assert.isTrue(value);
		});

		it('ignores malformed translator preferences', async function() {
			let prefs = await background(function() {
				Zotero.Connector._processTranslatorPreferences({
					translatorPrefsVersion: 1,
					translatorPrefs: {
						'../invalid': true,
						attachSupplementary: { enabled: true },
						supplementaryAsLink: false
					}
				});
				return Zotero.Prefs.getAll();
			});
			assert.isFalse(prefs['translators.supplementaryAsLink']);
			assert.notProperty(prefs, 'translators.../invalid');
			assert.notProperty(prefs, 'translators.attachSupplementary');
		});

		it('refreshes the effective preference namespace in the offscreen translator', async function() {
			await background(async function() {
				Zotero.Connector._processTranslatorPreferences({
					translatorPrefsVersion: 1,
					translatorPrefs: { attachSupplementary: true }
				});
				await Zotero.OffscreenManager.sendMessage('Prefs.loadNamespace', ['translators.']);
			});
			assert.isTrue(await offscreen(function() {
				return Zotero.Prefs.get('translators.attachSupplementary');
			}));

			await background(async function() {
				Zotero.Connector._processTranslatorPreferences();
				await Zotero.OffscreenManager.sendMessage('Prefs.loadNamespace', ['translators.']);
			});
			assert.isUndefined(await offscreen(function() {
				try {
					return Zotero.Prefs.get('translators.attachSupplementary');
				}
				catch (e) {
					return undefined;
				}
			}));
		});
	});

	describe('automatic attachment download policy', function() {
		beforeEach(async function() {
			await background(function() {
				Zotero.Connector._clearAutomaticAttachmentDownloads();
			});
		});

		it('classifies MIME types before generic MIME filename fallback', async function() {
			let values = await background(function() {
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'],
					enabled: { pdf: false },
				});
				return [
					Zotero.Connector.shouldDownloadAttachment({ mimeType: 'application/pdf', filename: 'file.docx' }),
					Zotero.Connector.shouldDownloadAttachment({ mimeType: 'application/octet-stream', filename: 'file.pdf' }),
					Zotero.Connector.shouldDownloadAttachment({ mimeType: 'text/plain', filename: 'file.pdf' }),
					Zotero.Connector.shouldDownloadAttachment({ mimeType: 'application/pdf' }, { automatic: false }),
				];
			});
			assert.deepEqual(values, [false, false, true, true]);
		});

		it('allows stock behavior for malformed policy data and clears on disconnect', async function() {
			let values = await background(function() {
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					// Missing genericMIMETypes makes this policy invalid.
					enabled: { pdf: false },
				});
				let malformed = Zotero.Connector.shouldDownloadAttachment({ mimeType: 'application/pdf' });
				Zotero.Connector._processAutomaticAttachmentDownloads({
					version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'],
					enabled: { pdf: false },
				});
				Zotero.Connector._clearAutomaticAttachmentDownloads();
				return [malformed, Zotero.Connector.shouldDownloadAttachment({ mimeType: 'application/pdf' })];
			});
			assert.deepEqual(values, [true, true]);
		});

	});
});
