describe("Advanced Preferences", function () {
	describe("PDF Annotations", function () {
		const STORAGE_MODE_PREF = 'reader.annotations.storageMode';
		let win;

		async function loadAdvancedPreferences() {
			win = await loadWindow("chrome://zotero/content/preferences/preferences.xhtml", {
				pane: 'zotero-prefpane-advanced'
			});
			await win.Zotero_Preferences.waitForFirstPaneLoad();
			return win.document.getElementById('annotation-storage-mode');
		}

		function selectMode(group, mode) {
			group.value = mode;
			group.dispatchEvent(new win.Event('command', {
				bubbles: true,
				cancelable: true,
			}));
		}

		afterEach(function () {
			sinon.restore();
			if (win && !win.closed) {
				win.close();
			}
			win = null;
		});

		it("should show exactly one selected mode and follow external preference changes", async function () {
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'standard');
			let group = await loadAdvancedPreferences();
			let radios = [...group.querySelectorAll('radio')];

			assert.lengthOf(radios, 3);
			assert.equal(group.value, 'standard');
			assert.equal(group.selectedItem.value, 'standard');
			assert.equal(group.getAttribute('aria-labelledby'),
				'preferences-advanced-pdf-annotations-title');
			assert.equal(group.getAttribute('aria-describedby'),
				'preferences-advanced-pdf-annotations-scope');
			for (let radio of radios) {
				assert.isNotEmpty(radio.getAttribute('tooltiptext'));
			}

			Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-and-zotero');
			await waitForCallback(() => group.value === 'pdf-and-zotero', 20, 10);
			assert.equal(group.selectedItem.value, 'pdf-and-zotero');
			assert.lengthOf(radios.filter(radio => radio.selected), 1);
		});

		it("should warn once only for transitions that erase a representation", async function () {
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'standard');
			let group = await loadAdvancedPreferences();
			let confirm = sinon.stub(
				win.Zotero_Preferences.Advanced,
				'_confirmAnnotationStorageModeChange'
			).returns(true);
			let cases = [
				['standard', 'pdf-only', true],
				['pdf-and-zotero', 'pdf-only', true],
				['pdf-only', 'standard', true],
				['pdf-and-zotero', 'standard', true],
				['standard', 'pdf-and-zotero', false],
				['pdf-only', 'pdf-and-zotero', false],
			];

			for (let [from, to, shouldWarn] of cases) {
				Zotero.Prefs.set(STORAGE_MODE_PREF, from);
				await waitForCallback(() => group.value === from, 20, 10);
				confirm.resetHistory();
				selectMode(group, to);

				assert.equal(confirm.callCount, shouldWarn ? 1 : 0, `${from} -> ${to}`);
				assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), to, `${from} -> ${to}`);
			}
		});

		it("should restore the previous selection when a warning is cancelled", async function () {
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'standard');
			let group = await loadAdvancedPreferences();
			let confirm = sinon.stub(
				win.Zotero_Preferences.Advanced,
				'_confirmAnnotationStorageModeChange'
			).returns(false);

			selectMode(group, 'pdf-only');

			assert.isTrue(confirm.calledOnce);
			assert.equal(group.value, 'standard');
			assert.equal(group.selectedItem.value, 'standard');
			assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), 'standard');
		});
	});

	describe("Files & Folders", function () {
		describe("Linked Attachment Base Directory", function () {
			var setBaseDirectory = async function (basePath) {
				var win = await loadWindow("chrome://zotero/content/preferences/preferences.xhtml", {
					pane: 'zotero-prefpane-advanced'
				});
				
				// Wait for tab to load
				await win.Zotero_Preferences.waitForFirstPaneLoad();
				
				var promise = waitForDialog();
				await win.Zotero_Preferences.Attachment_Base_Directory.changePath(basePath);
				await promise;
				
				win.close();
			};
			
			var clearBaseDirectory = async function (basePath) {
				var win = await loadWindow("chrome://zotero/content/preferences/preferences.xhtml", {
					pane: 'zotero-prefpane-advanced',
					tabIndex: 1
				});
				
				// Wait for tab to load
				await win.Zotero_Preferences.waitForFirstPaneLoad();
				
				var promise = waitForDialog();
				await win.Zotero_Preferences.Attachment_Base_Directory.clearPath();
				await promise;
				
				win.close();
			};
			
			beforeEach(function () {
				Zotero.Prefs.clear('baseAttachmentPath');
				Zotero.Prefs.clear('saveRelativeAttachmentPath');
			});
			
			it("should set new base directory", async function () {
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				assert.equal(Zotero.Prefs.get('baseAttachmentPath'), basePath);
				assert.isTrue(Zotero.Prefs.get('saveRelativeAttachmentPath'));
			})
			
			it("should clear base directory", async function () {
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				await clearBaseDirectory();
				
				assert.equal(Zotero.Prefs.get('baseAttachmentPath'), '');
				assert.isFalse(Zotero.Prefs.get('saveRelativeAttachmentPath'));
			})
			
			it("should change absolute path of linked attachment under new base dir to prefixed path", async function () {
				var file = getTestDataDirectory();
				file.append('test.png');
				var attachment = await Zotero.Attachments.linkFromFile({ file });
				assert.equal(attachment.attachmentPath, file.path);
				
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				
				assert.equal(
					attachment.attachmentPath,
					Zotero.Attachments.BASE_PATH_PLACEHOLDER + 'test.png'
				);
			})
			
			it("should change prefixed path to absolute when changing base directory", async function () {
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				
				var file = getTestDataDirectory();
				file.append('test.png');
				var attachment = await Zotero.Attachments.linkFromFile({ file });
				assert.equal(
					attachment.attachmentPath,
					Zotero.Attachments.BASE_PATH_PLACEHOLDER + 'test.png'
				);
				
				// Choose a nonexistent directory for the base path
				var otherPath = OS.Path.join(OS.Path.dirname(basePath), 'foobar');
				await setBaseDirectory(otherPath);
				
				assert.equal(attachment.attachmentPath, file.path);
			})
			
			it("should change prefixed path to absolute when clearing base directory", async function () {
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				
				var file = getTestDataDirectory();
				file.append('test.png');
				var attachment = await Zotero.Attachments.linkFromFile({ file });
				assert.equal(
					attachment.attachmentPath,
					Zotero.Attachments.BASE_PATH_PLACEHOLDER + 'test.png'
				);
				
				await clearBaseDirectory();
				
				assert.equal(Zotero.Prefs.get('baseAttachmentPath'), '');
				assert.isFalse(Zotero.Prefs.get('saveRelativeAttachmentPath'));
				
				assert.equal(attachment.attachmentPath, file.path);
			});
			
			it("should ignore attachment with relative path already within new base directory", async function () {
				var file = getTestDataDirectory();
				file.append('test.png');
				file = file.path;
				
				var attachment = await Zotero.Attachments.linkFromFile({ file });
				assert.equal(attachment.attachmentPath, file);
				
				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);
				
				var newBasePath = await getTempDirectory();
				await IOUtils.copy(file, PathUtils.joinRelative(newBasePath, 'test.png'));
				
				await setBaseDirectory(newBasePath);
				
				assert.equal(
					attachment.attachmentPath,
					Zotero.Attachments.BASE_PATH_PLACEHOLDER + 'test.png'
				);
			});

			it("should ignore attachment with invalid relative path", async function () {
				var file = getTestDataDirectory();
				file.append('test.pdf');
				file = file.path;
				
				var attachment = createUnsavedDataObject('item', { itemType: 'attachment' });
				attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
				attachment.attachmentPath = 'attachments:/test.pdf'; // Invalid
				await attachment.saveTx();

				var basePath = getTestDataDirectory().path;
				await setBaseDirectory(basePath);

				var newBasePath = await getTempDirectory();
				await IOUtils.copy(file, PathUtils.joinRelative(newBasePath, 'test.pdf'));

				await setBaseDirectory(newBasePath);

				assert.equal(
					attachment.attachmentPath,
					Zotero.Attachments.BASE_PATH_PLACEHOLDER + '/test.pdf'
				);
			});
		})
	})
})
