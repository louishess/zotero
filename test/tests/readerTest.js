"use strict";

describe("Reader", function () {
	var win, zp;

	before(function* () {
		win = yield loadZoteroPane();
		zp = win.ZoteroPane;
	});

	after(function () {
		win.Zotero_Tabs.closeAll();
		win.close();
	});

	describe('PDF Reader', function () {
		afterEach(function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
		});

		it('should create/update annotations', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', false);
			var attachment = await importFileAttachment('test.pdf');

			var reader = await Zotero.Reader.open(attachment.itemID);
			await reader._initPromise;
			reader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;

			// Add highlight annotation
			let highlightAnnotation = reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'highlight',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					position: {
						pageIndex: 0,
						rects: [[0, 0, 100, 100]]
					},
					text: 'test'
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");
			// Add underline annotation
			let underlineAnnotation = await reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'underline',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					position: {
						pageIndex: 0,
						rects: [[0, 0, 100, 100]]
					},
					text: 'test'
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");
			// Add note annotation
			let noteAnnotation = await reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'note',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					comment: 'test',
					position: {
						pageIndex: 0,
						rects: [[0, 0, 100, 100]]
					},
					text: 'test'
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");
			// Add text annotation
			let textAnnotation = await reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'text',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					comment: 'test',
					position: {
						pageIndex: 0,
						rects: [[17.70514027630181, 729.1404633368757, 132.24914027630183, 762.1404633368757]],
						fontSize: 14,
						rotation: 10
					},
					text: 'test'
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");
			// Add image annotation
			let imageAnnotation = await reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'image',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					comment: 'test',
					position: {
						pageIndex: 0,
						rects: [[0, 0, 100, 100]]
					}
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");
			// Add ink annotation
			let inkAnnotation = await reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'ink',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					position: {
						pageIndex: 0,
						paths: [[517.759, 760.229]],
						width: 2
					},
				}, reader._iframeWindow)
			);
			await waitForItemEvent("add");

			// Modify highlight annotation
			reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: highlightAnnotation.id,
						text: 'test2'
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");
			// Modify underline annotation
			await reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: underlineAnnotation.id,
						text: 'test2'
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");
			// Modify note annotation
			await reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: noteAnnotation.id,
						color: '#aabbcc'
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");
			// Modify text annotation
			await reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: textAnnotation.id,
						sortIndex: '00000|001491|00283',
						position: {
							pageIndex: 0,
							rects: [[17.70514027630181, 729.1404633368757, 132.24914027630183, 762.1404633368757]],
							fontSize: 16,
							rotation: 10
						},
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");
			// Modify image annotation
			await reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: imageAnnotation.id,
						sortIndex: '00000|001491|00283',
						position: {
							pageIndex: 0,
							rects: [[0, 0, 200, 200]]
						}
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");
			// Modify ink annotation
			await reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{
						id: inkAnnotation.id,
						sortIndex: '00000|001491|00283',
						position: {
							pageIndex: 0,
							paths: [[617.759, 560.229]],
							width: 2,
							unknownField: 'test'
						},
					}
				], reader._iframeWindow)
			);
			await waitForItemEvent("modify");

			var annotations = attachment.getAnnotations();
			assert.equal(annotations.length, 6);

			assert.equal(annotations.find(x => x.key === highlightAnnotation.id).annotationText, 'test2');
			assert.equal(annotations.find(x => x.key === underlineAnnotation.id).annotationText, 'test2');
			assert.equal(annotations.find(x => x.key === noteAnnotation.id).annotationColor, '#aabbcc');
			assert.equal(JSON.parse(annotations.find(x => x.key === textAnnotation.id).annotationPosition).fontSize, 16);
			assert.equal(JSON.parse(annotations.find(x => x.key === imageAnnotation.id).annotationPosition).rects[0][2], 200);
			assert.equal(JSON.parse(annotations.find(x => x.key === inkAnnotation.id).annotationPosition).pageIndex, 0);
			assert.equal(JSON.parse(annotations.find(x => x.key === inkAnnotation.id).annotationPosition).unknownField, 'test');
			reader.close();
		});

		it('should create, update, tag, and delete annotations in the PDF only', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
			let attachment = await importFileAttachment('test.pdf');
			let reader = await Zotero.Reader.open(attachment.itemID);
			await reader._initPromise;
			reader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;
			assert.isTrue(reader._fileAnnotationMode);

			let annotation = reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'highlight',
					color: '#ffd400',
					sortIndex: '00000|003305|00000',
					position: { pageIndex: 0, rects: [[0, 0, 100, 100]] },
					text: 'file backed'
				}, reader._iframeWindow)
			);
			await waitForCallback(() => reader._fileAnnotations.has(annotation.id), 20, 10);
			assert.lengthOf(attachment.getAnnotations(), 0);
			let result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isOk(result.annotations.find(x => x.id === annotation.id));

			reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([{
					id: annotation.id,
					comment: 'updated in place'
				}], reader._iframeWindow)
			);
			await waitForCallback(
				() => reader._fileAnnotations.get(annotation.id)?.comment === 'updated in place',
				20,
				10
			);

			let tagItem = reader._getFileAnnotationTagItem(annotation.id);
			tagItem.addTag('embedded-tag');
			await tagItem.saveTx();
			result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			let stored = result.annotations.find(x => x.id === annotation.id);
			assert.equal(stored.comment, 'updated in place');
			assert.deepEqual(stored.tags, [{ name: 'embedded-tag' }]);
			assert.lengthOf(attachment.getAnnotations(), 0);

			assert.equal(reader._internalReader.deleteAnnotations(
				Components.utils.cloneInto([annotation.id], reader._iframeWindow)
			), 1);
			await waitForCallback(() => !reader._fileAnnotations.has(annotation.id), 20, 10);
			result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isFalse(result.annotations.some(x => x.id === annotation.id));
			assert.lengthOf(attachment.getAnnotations(), 0);
			reader.close();
		});

		it('should migrate and later delete a legacy annotation by its stable ID', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
			let attachment = await importFileAttachment('test.pdf');
			let legacy = await Zotero.Annotations.saveFromJSON(attachment, {
				key: Zotero.DataObjectUtilities.generateKey(),
				type: 'highlight',
				isExternal: false,
				readOnly: false,
				text: 'legacy annotation',
				comment: '',
				color: '#ffd400',
				pageLabel: '1',
				sortIndex: '00000|003305|00000',
				position: { pageIndex: 0, rects: [[0, 0, 100, 100]] },
				tags: [],
				dateModified: '2026-01-02T03:04:05.000Z'
			});
			let prompt = Services.prompt;
			Services.prompt = { confirmEx: () => 0 };
			let reader;
			try {
				reader = await Zotero.Reader.open(attachment.id);
				await reader._initPromise;
			}
			finally {
				Services.prompt = prompt;
			}

			assert.isTrue(reader._fileAnnotationMode);
			assert.lengthOf(attachment.getAnnotations(), 0);
			let result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isOk(result.annotations.find(x => x.id === legacy.key));

			assert.equal(reader._internalReader.deleteAnnotations(
				Components.utils.cloneInto([legacy.key], reader._iframeWindow)
			), 1);
			await waitForCallback(() => !reader._fileAnnotations.has(legacy.key), 20, 10);
			result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isFalse(result.annotations.some(x => x.id === legacy.key));
			reader.close();
		});

		it('should persist every supported annotation type across rapid edits and reopen', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
			let attachment = await importFileAttachment('test.pdf');
			let reader = await Zotero.Reader.open(attachment.id);
			await reader._initPromise;
			reader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;

			let inputs = [{
				type: 'highlight',
				position: { pageIndex: 0, rects: [[50, 700, 150, 712]] },
				text: 'highlight'
			}, {
				type: 'underline',
				position: { pageIndex: 0, rects: [[50, 680, 150, 692]] },
				text: 'underline'
			}, {
				type: 'note',
				position: { pageIndex: 0, rects: [[50, 640, 72, 662]] },
				comment: 'note'
			}, {
				type: 'text',
				position: {
					pageIndex: 0,
					rects: [[80, 590, 200, 630]],
					fontSize: 12,
					rotation: 0
				},
				comment: 'free text'
			}, {
				type: 'image',
				position: { pageIndex: 0, rects: [[220, 590, 300, 650]] }
			}, {
				type: 'ink',
				position: {
					pageIndex: 0,
					paths: [[320, 600, 340, 620, 360, 600]],
					width: 2
				}
			}];
			let annotations = inputs.map((input, index) => (
				reader._internalReader._annotationManager.addAnnotation(
					Components.utils.cloneInto({
						...input,
						color: '#ffd400',
						sortIndex: `00000|00000${index}|00000`
					}, reader._iframeWindow)
				)
			));
			await waitForFileAnnotationMutations(reader);

			assert.notOk(reader._internalReader._state.readOnly);
			assert.lengthOf(attachment.getAnnotations(), 0);
			let result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.sameMembers(
				result.annotations.filter(annotation => annotations.some(x => x.id === annotation.id))
					.map(annotation => annotation.type),
				['highlight', 'underline', 'note', 'text', 'image', 'ink']
			);

			let underline = annotations.find(annotation => annotation.type === 'underline');
			let note = annotations.find(annotation => annotation.type === 'note');
			reader._internalReader._annotationManager.updateAnnotations(
				Components.utils.cloneInto([
					{ id: underline.id, comment: 'underlined comment' },
					{ id: note.id, comment: 'updated note' }
				], reader._iframeWindow)
			);
			await waitForFileAnnotationMutations(reader);
			let tagItem = reader._getFileAnnotationTagItem(underline.id);
			tagItem.addTag('embedded-tag');
			await tagItem.saveTx();
			let annotationIDs = annotations.map(annotation => annotation.id);
			let noteID = note.id;
			let underlineID = underline.id;

			reader.close();
			await cleanupReaders(reader);
			reader = await Zotero.Reader.open(attachment.id);
			await reader._initPromise;
			reader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;
			result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.equal(result.annotations.find(x => x.id === noteID).comment, 'updated note');
			assert.deepEqual(
				result.annotations.find(x => x.id === underlineID).tags,
				[{ name: 'embedded-tag' }]
			);
			assert.notOk(reader._internalReader._state.readOnly);

			for (let id of annotationIDs) {
				assert.equal(reader._internalReader.deleteAnnotations(
					Components.utils.cloneInto([id], reader._iframeWindow)
				), 1);
				await waitForFileAnnotationMutations(reader);
			}
			result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isFalse(result.annotations.some(annotation => annotationIDs.includes(annotation.id)));
			assert.lengthOf(attachment.getAnnotations(), 0);
			reader.close();
		});

		it('should rebase queued Zotero writes but reject an external PDF change', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
			let attachment = await importFileAttachment('test.pdf');
			let initial = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			let makeAnnotation = (id, y) => ({
				id,
				type: 'highlight',
				color: '#ffd400',
				comment: '',
				authorName: '',
				dateModified: new Date().toISOString(),
				tags: [],
				position: { pageIndex: 0, rects: [[50, y, 150, y + 12]] }
			});
			let expectedState = {
				fileToken: initial.fileToken,
				fileRevision: initial.fileRevision
			};
			await Promise.all([
				Zotero.PDFWorker.applyAnnotationChanges(
					attachment.id,
					{ upserts: [{ annotation: makeAnnotation('REBASE01', 700) }] },
					expectedState,
					true
				),
				Zotero.PDFWorker.applyAnnotationChanges(
					attachment.id,
					{ upserts: [{ annotation: makeAnnotation('REBASE02', 680) }] },
					expectedState,
					true
				)
			]);
			let result = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isOk(result.annotations.find(annotation => annotation.id === 'REBASE01'));
			assert.isOk(result.annotations.find(annotation => annotation.id === 'REBASE02'));
			let reader = await Zotero.Reader.open(attachment.id);
			await reader._initPromise;
			reader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;

			let path = await attachment.getFilePathAsync();
			let bytes = await IOUtils.read(path);
			let externalMarker = new TextEncoder().encode('\n% external change\n');
			let changed = new Uint8Array(bytes.length + externalMarker.length);
			changed.set(bytes);
			changed.set(externalMarker, bytes.length);
			await IOUtils.write(path, changed);
			let rejected = reader._internalReader._annotationManager.addAnnotation(
				Components.utils.cloneInto({
					type: 'highlight',
					color: '#ffd400',
					sortIndex: '00000|000003|00000',
					position: { pageIndex: 0, rects: [[50, 660, 150, 672]] }
				}, reader._iframeWindow)
			);
			await waitForCallback(
				() => !reader._internalReader._annotationManager._savingInProgress,
				200,
				10
			);
			let error = await getPromiseError(reader._fileAnnotationMutationPromise);
			assert.equal(error.name, 'FileChangedException');
			assert.isTrue(reader._internalReader._state.readOnly);

			await reader.reload();
			assert.notOk(reader._internalReader._state.readOnly);
			assert.isFalse(reader._fileAnnotations.has(rejected.id));
			reader.close();
		});

		it('should synchronize file-backed changes between two open readers', async function () {
			Zotero.Prefs.set('reader.annotations.saveToFile', true);
			let attachment = await importFileAttachment('test.pdf');
			let reader1;
			let reader2;
			try {
				reader1 = await Zotero.Reader.open(attachment.id);
				reader2 = await Zotero.Reader.open(
					attachment.id,
					null,
					{ allowDuplicate: true, openInBackground: true }
				);
				await Promise.all([reader1._initPromise, reader2._initPromise]);
				reader1._internalReader._annotationManager._skipAnnotationSavingDebounce = true;
				reader2._internalReader._annotationManager._skipAnnotationSavingDebounce = true;

				let annotation = reader1._internalReader._annotationManager.addAnnotation(
					Components.utils.cloneInto({
						type: 'note',
						color: '#ffd400',
						comment: 'first reader',
						sortIndex: '00000|000001|00000',
						position: { pageIndex: 0, rects: [[50, 640, 72, 662]] }
					}, reader1._iframeWindow)
				);
				let annotationID = annotation.id;
				await waitForFileAnnotationMutations(reader1);
				await waitForCallback(
					() => reader2._fileAnnotations.get(annotationID)?.comment === 'first reader',
					100,
					10
				);

				reader2._internalReader._annotationManager.updateAnnotations(
					Components.utils.cloneInto([{
						id: annotationID,
						comment: 'second reader'
					}], reader2._iframeWindow)
				);
				await waitForFileAnnotationMutations(reader2);
				await waitForCallback(
					() => reader1._fileAnnotations.get(annotationID)?.comment === 'second reader',
					100,
					10
				);

				assert.equal(reader1._internalReader.deleteAnnotations(
					Components.utils.cloneInto([annotationID], reader1._iframeWindow)
				), 1);
				await waitForFileAnnotationMutations(reader1);
				await waitForCallback(
					() => !reader2._fileAnnotations.has(annotationID),
					100,
					10
				);
				assert.lengthOf(attachment.getAnnotations(), 0);
			}
			finally {
				await cleanupReaders(reader1, reader2);
			}
		});

		async function cleanupReaders(...readers) {
			for (let reader of readers.filter(Boolean)) {
				reader.close();
			}
			await Zotero.Promise.delay(100);
			for (let reader of readers.filter(Boolean)) {
				let index = Zotero.Reader._readers.indexOf(reader);
				if (index !== -1) {
					reader.uninit();
					Zotero.Reader._readers.splice(index, 1);
				}
			}
		}

		async function waitForFileAnnotationMutations(reader) {
			let manager = reader._internalReader._annotationManager;
			await waitForCallback(
				() => !manager._savingInProgress && !manager._unsavedAnnotations.size,
				200,
				10
			);
			await reader._fileAnnotationMutationPromise;
			await Zotero.Reader.waitForFileAnnotationMutations(reader.itemID);
		}

		it('should reopen a reader whose tab closes during a notifier transaction', async function () {
			let reader, reopenedReader;
			let title = Zotero.Promise.defer();
			let updates = [];
			let sandbox = sinon.createSandbox();
			let transactionOpen = false;

			try {
				let attachment = await importFileAttachment('test.pdf');
				reader = await Zotero.Reader.open(attachment.id);
				await reader._initPromise;
				let oldTabContainer = win.document.getElementById(reader.tabID);
				sandbox.stub(attachment, 'getTabTitle').returns(title.promise);
				let updateTitleSpy = sandbox.spy(reader, 'updateTitle');
				let setTitleSpy = sandbox.spy(reader, '_setTitleValue');
				let disposeSpy = sandbox.spy(reader._blockingObserver, 'dispose');
				updates.push(reader.updateTitle());

				Zotero.Notifier.begin();
				transactionOpen = true;
				win.Zotero_Tabs.close(reader.tabID);
				await waitForCallback(() => !oldTabContainer.isConnected, 10, 5);
				assert.isTrue(reader._isTabClosed);
				sinon.assert.calledOnce(disposeSpy);
				assert.isNull(reader._blockingObserver);
				Zotero.Reader.notify('modify', 'item', [attachment.id], {});
				updates.push(...updateTitleSpy.getCalls().slice(1).map(call => call.returnValue));
				assert.equal(updateTitleSpy.callCount, 2);

				reopenedReader = await Zotero.Reader.open(attachment.id);
				assert.notStrictEqual(reopenedReader, reader);

				title.resolve('Stale title');
				await Promise.all(updates);
				sinon.assert.notCalled(setTitleSpy);
				await reopenedReader._initPromise;

				await Zotero.Notifier.commit();
				transactionOpen = false;
				assert.isFalse(Zotero.Reader._readers.includes(reader));
			}
			finally {
				title.resolve('Stale title');
				try {
					await Promise.all(updates);
				}
				catch {}
				sandbox.restore();
				if (transactionOpen) Zotero.Notifier.reset();
				await cleanupReaders(reader, reopenedReader);
			}
		});

		it('should reuse a queued unloaded reader tab and preserve its close callback', async function () {
			let reader, reloadedReader, openResult, tabID, unloadedTab;
			let closeCalls = 0, callbackHadExpectedReceiver, callbackSawOpenReader;
			let transactionOpen = false;

			try {
				let attachment = await importFileAttachment('test.pdf');
				reader = await Zotero.Reader.open(attachment.id);
				await reader._initPromise;
				tabID = reader.tabID;
				let oldTabContainer = win.document.getElementById(tabID);
				win.Zotero_Tabs.select('zotero-pane');
				Zotero.Notifier.begin();
				transactionOpen = true;
				win.Zotero_Tabs.unload(tabID);
				await waitForCallback(() => !oldTabContainer.isConnected, 10, 5);
				unloadedTab = win.Zotero_Tabs._getTab(tabID).tab;
				unloadedTab.onClose = function () {
					closeCalls++;
					callbackHadExpectedReceiver = this === unloadedTab;
					callbackSawOpenReader = reloadedReader && !reloadedReader._isTabClosed;
				};

				openResult = await Zotero.Reader.open(attachment.id);
				assert.isTrue(openResult === undefined, 'should select the unloaded tab');
				reloadedReader = await waitForCallback(
					() => Zotero.Reader._readers.find(r => r !== reader && r.tabID === tabID),
					50, 5
				);
				await reloadedReader._initPromise;

				await Zotero.Notifier.commit();
				transactionOpen = false;
				assert.strictEqual(Zotero.Reader.getByTabID(tabID), reloadedReader);

				win.Zotero_Tabs.close(tabID);
				await waitForCallback(
					() => !Zotero.Reader._readers.includes(reloadedReader), 10, 5);
				assert.equal(closeCalls, 1);
				assert.isTrue(callbackHadExpectedReceiver);
				assert.isTrue(callbackSawOpenReader);
				assert.isTrue(reloadedReader._isTabClosed);
			}
			finally {
				if (transactionOpen) Zotero.Notifier.reset();
				let tab = tabID && win.Zotero_Tabs._getTab(tabID).tab;
				if (tab) tab.onClose = null;
				if (tab) win.Zotero_Tabs.close(tabID);
				await cleanupReaders(reader, reloadedReader, openResult);
			}
		});

		it('should open a reader window while a closed tab reader is pending', async function () {
			let reader, windowReader, unloadedTabID;
			let transactionOpen = false;

			try {
				let attachment = await importFileAttachment('test.pdf');
				reader = await Zotero.Reader.open(attachment.id);
				await reader._initPromise;
				({ id: unloadedTabID } = win.Zotero_Tabs.add({
					type: 'reader-unloaded',
					data: { itemID: attachment.id },
				}));
				Zotero.Notifier.begin();
				transactionOpen = true;
				win.Zotero_Tabs.close(reader.tabID);

				windowReader = await Zotero.Reader.open(
					attachment.id, null, { openInWindow: true });
				await windowReader._initPromise;
				assert.equal(win.Zotero_Tabs._getTab(unloadedTabID).tab.type, 'reader-unloaded');

				await Zotero.Notifier.commit();
				transactionOpen = false;
			}
			finally {
				if (transactionOpen) Zotero.Notifier.reset();
				if (win.Zotero_Tabs._getTab(unloadedTabID).tab) {
					win.Zotero_Tabs.close(unloadedTabID);
				}
				await cleanupReaders(reader, windowReader);
			}
		});

		describe("#importFromEPUB()", function () {
			let bookEpubPath; // The EPUB itself
			let bookSdrPath; // The KOReader "sidecar" folder
			let calibreBookmarksPath; // The calibre_bookmarks.txt file (we'll copy this into META_INF for some tests)
			let metadataOpfPath; // The Calibre metadata.opf file

			let tempPath;
			let tempBookEpubPath;

			async function waitForReader(reader) {
				await reader._initPromise;
				// Shouldn't this just be included in _initPromise?
				await reader._internalReader._primaryView.initializedPromise;
			}
			
			async function waitForAdds(n) {
				while (n > 0) {
					n -= (await waitForItemEvent('add')).length;
				}
			}
			
			before(function () {
				bookEpubPath = getTestDataDirectory();
				bookEpubPath.append('moby_dick');
				bookEpubPath.append('book.epub');
				bookEpubPath = bookEpubPath.path;
				
				calibreBookmarksPath = getTestDataDirectory();
				calibreBookmarksPath.append('moby_dick');
				calibreBookmarksPath.append('calibre_bookmarks.txt');
				calibreBookmarksPath = calibreBookmarksPath.path;

				metadataOpfPath = getTestDataDirectory();
				metadataOpfPath.append('moby_dick');
				metadataOpfPath.append('metadata.opf');
				metadataOpfPath = metadataOpfPath.path;

				bookSdrPath = getTestDataDirectory();
				bookSdrPath.append('moby_dick');
				bookSdrPath.append('book.sdr');
				bookSdrPath = bookSdrPath.path;
			});
			
			beforeEach(async function () {
				tempPath = await getTempDirectory();
				tempBookEpubPath = PathUtils.join(tempPath, 'book.epub');
				await IOUtils.copy(bookEpubPath, tempBookEpubPath);
			});
			
			it("should import EPUB annotations from KOReader (stored alongside EPUB)", async function () {
				await IOUtils.copy(bookSdrPath, PathUtils.join(tempPath, 'book.sdr'), { recursive: true });
				
				let attachment = await Zotero.Attachments.linkFromFile({ file: tempBookEpubPath });
				let reader = await Zotero.Reader.open(attachment.id);
				await waitForReader(reader);
				
				let donePromise = Promise.all([waitForDialog(), waitForAdds(2)]);
				await reader.importFromEPUB();
				await donePromise;
				
				assert.equal(attachment.getAnnotations().length, 2);
			});
			
			it("should import EPUB annotations from KOReader (stored elsewhere)", async function () {
				let attachment = await Zotero.Attachments.linkFromFile({ file: tempBookEpubPath });
				let reader = await Zotero.Reader.open(attachment.id);
				await waitForReader(reader);

				let donePromise = Promise.all([waitForDialog(), waitForAdds(2)]);
				// Import annotations from the *original* EPUB (alongside its book.sdr/metadata.epub.lua)
				await reader.importFromEPUB(bookEpubPath);
				await donePromise;
				
				assert.equal(attachment.getAnnotations().length, 2);
			});

			it("should import EPUB annotations from Calibre (stored alongside EPUB)", async function () {
				await IOUtils.copy(metadataOpfPath, PathUtils.join(tempPath, 'metadata.opf'));

				let attachment = await Zotero.Attachments.linkFromFile({ file: tempBookEpubPath });
				let reader = await Zotero.Reader.open(attachment.id);
				await waitForReader(reader);

				let donePromise = Promise.all([waitForDialog(), waitForAdds(2)]);
				await reader.importFromEPUB();
				await donePromise;

				assert.equal(attachment.getAnnotations().length, 2);
			});

			it("should import EPUB annotations from Calibre (stored within EPUB)", async function () {
				let zipWriter = Cc['@mozilla.org/zipwriter;1'].createInstance(Ci.nsIZipWriter);
				zipWriter.open(Zotero.File.pathToFile(tempBookEpubPath), 0x04 /* RDWR */);
				zipWriter.addEntryFile(
					'META-INF/calibre_bookmarks.txt',
					Ci.nsIZipWriter.COMPRESSION_DEFAULT,
					Zotero.File.pathToFile(calibreBookmarksPath),
					false,
				);
				zipWriter.close();
				
				let attachment = await Zotero.Attachments.linkFromFile({ file: tempBookEpubPath });
				let reader = await Zotero.Reader.open(attachment.id);
				await waitForReader(reader);

				let donePromise = Promise.all([waitForDialog(), waitForAdds(2)]);
				await reader.importFromEPUB();
				await donePromise;

				assert.equal(attachment.getAnnotations().length, 2);
			});
		});
	});
});
