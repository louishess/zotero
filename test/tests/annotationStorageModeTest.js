"use strict";

describe("Annotation storage modes", function () {
	const STORAGE_MODE_PREF = 'reader.annotations.storageMode';
	const LEGACY_PREF = 'reader.annotations.saveToFile';
	const PREVIOUS_PREF_VERSION = 22;
	const CURRENT_PREF_VERSION = 23;

	function saveUserPref(pref) {
		return Zotero.Prefs.prefHasUserValue(pref)
			? { hasUserValue: true, value: Zotero.Prefs.get(pref) }
			: { hasUserValue: false };
	}

	function restoreUserPref(pref, saved) {
		Zotero.Prefs.clear(pref);
		if (saved.hasUserValue) {
			Zotero.Prefs.set(pref, saved.value);
		}
	}

	describe("preference migration", function () {
		let savedPrefs;
		let sandbox;

		beforeEach(function () {
			sandbox = sinon.createSandbox();
			savedPrefs = new Map([
				['prefVersion', saveUserPref('prefVersion')],
				[STORAGE_MODE_PREF, saveUserPref(STORAGE_MODE_PREF)],
				[LEGACY_PREF, saveUserPref(LEGACY_PREF)],
			]);
			Zotero.Prefs.clear('prefVersion');
			Zotero.Prefs.clear(STORAGE_MODE_PREF);
			Zotero.Prefs.clear(LEGACY_PREF);
			sandbox.stub(Zotero.Prefs, 'register');
			sandbox.stub(Zotero.Prefs, '_checkUserJS');
			sandbox.stub(Zotero, 'addShutdownListener');
		});

		afterEach(function () {
			sandbox.restore();
			for (let [pref, saved] of savedPrefs) {
				restoreUserPref(pref, saved);
			}
		});

		async function runUpgrade(legacyValue) {
			Zotero.Prefs.set('prefVersion', PREVIOUS_PREF_VERSION);
			if (legacyValue !== undefined) {
				Zotero.Prefs.set(LEGACY_PREF, legacyValue);
			}
			await Zotero.Prefs.init();
		}

		it("should default fresh profiles to Standard without running the legacy migration", async function () {
			await Zotero.Prefs.init();

			assert.equal(Zotero.Prefs.get('prefVersion'), CURRENT_PREF_VERSION);
			assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), 'standard');
			assert.isFalse(Zotero.Prefs.prefHasUserValue(STORAGE_MODE_PREF));
		});

		it("should migrate an explicit legacy false value to Standard", async function () {
			await runUpgrade(false);

			assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), 'standard');
			assert.isFalse(Zotero.Prefs.prefHasUserValue(LEGACY_PREF));
		});

		it("should migrate an explicit legacy true value to PDF-only", async function () {
			await runUpgrade(true);

			assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), 'pdf-only');
			assert.isTrue(Zotero.Prefs.prefHasUserValue(STORAGE_MODE_PREF));
			assert.isFalse(Zotero.Prefs.prefHasUserValue(LEGACY_PREF));
		});

		it("should preserve the legacy default-true behavior for an existing profile", async function () {
			await runUpgrade();

			assert.equal(Zotero.Prefs.get(STORAGE_MODE_PREF), 'pdf-only');
			assert.isTrue(Zotero.Prefs.prefHasUserValue(STORAGE_MODE_PREF));
			assert.isFalse(Zotero.Prefs.prefHasUserValue(LEGACY_PREF));
		});
	});

	describe("mode and capability helpers", function () {
		let savedStorageMode;
		let sandbox;

		function makeItem(overrides = {}) {
			let item = {
				isPDFAttachment: () => true,
				library: {
					libraryType: 'user',
					editable: true,
					filesEditable: true,
				},
				isEditable: () => true,
				deleted: false,
				parentItem: null,
				getFilePathAsync: async () => '/tmp/test.pdf',
			};
			return Object.assign(item, overrides);
		}

		beforeEach(function () {
			sandbox = sinon.createSandbox();
			savedStorageMode = saveUserPref(STORAGE_MODE_PREF);
			Zotero.Prefs.clear(STORAGE_MODE_PREF);
		});

		afterEach(function () {
			sandbox.restore();
			restoreUserPref(STORAGE_MODE_PREF, savedStorageMode);
		});

		it("should expose and return each configured mode", function () {
			assert.deepEqual(Zotero.PDFWorker.ANNOTATION_STORAGE_MODE_VALUES,
				['standard', 'pdf-only', 'pdf-and-zotero']);
			for (let mode of Zotero.PDFWorker.ANNOTATION_STORAGE_MODE_VALUES) {
				Zotero.Prefs.set(STORAGE_MODE_PREF, mode);
				assert.equal(Zotero.PDFWorker.getConfiguredAnnotationStorageMode(), mode);
			}
		});

		it("should safely treat an invalid configured value as Standard", function () {
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'invalid');
			let logError = sandbox.stub(Zotero, 'logError');

			assert.equal(Zotero.PDFWorker.getConfiguredAnnotationStorageMode(), 'standard');
			assert.isTrue(logError.calledOnce);
		});

		it("should distinguish file writability from the configured mode", async function () {
			let pathToFile = sandbox.stub(Zotero.File, 'pathToFile').returns({
				isWritable: () => true,
				parent: { isWritable: () => true },
			});
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'standard');

			assert.isTrue(await Zotero.PDFWorker.canWriteAnnotationsToFile(makeItem()));
			assert.isTrue(pathToFile.calledOnce);
		});

		it("should require both the PDF and its parent directory to be writable", async function () {
			let fileWritable = false;
			let parentWritable = true;
			sandbox.stub(Zotero.File, 'pathToFile').returns({
				isWritable: () => fileWritable,
				parent: { isWritable: () => parentWritable },
			});

			assert.isFalse(await Zotero.PDFWorker.canWriteAnnotationsToFile(makeItem()));
			fileWritable = true;
			parentWritable = false;
			assert.isFalse(await Zotero.PDFWorker.canWriteAnnotationsToFile(makeItem()));
			parentWritable = true;
			assert.isTrue(await Zotero.PDFWorker.canWriteAnnotationsToFile(makeItem()));
		});

		it("should force unsupported or read-only attachments to Standard", async function () {
			let supportedItem = makeItem();
			let canWrite = sandbox.stub(Zotero.PDFWorker, 'canWriteAnnotationsToFile');
			Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-and-zotero');
			canWrite.withArgs(supportedItem).resolves(true);

			assert.equal(
				await Zotero.PDFWorker.getEffectiveAnnotationStorageMode(supportedItem),
				'pdf-and-zotero'
			);
			assert.equal(
				await Zotero.PDFWorker.getEffectiveAnnotationStorageMode(makeItem({
					isPDFAttachment: () => false,
				})),
				'standard'
			);
			assert.isTrue(await Zotero.PDFWorker.canUseFileAnnotations(supportedItem));
		});

		it("should reject ineligible items before checking filesystem writability", async function () {
			let pathToFile = sandbox.stub(Zotero.File, 'pathToFile');
			let cases = [
				null,
				makeItem({ isPDFAttachment: () => false }),
				makeItem({ library: { libraryType: 'group', editable: true, filesEditable: true } }),
				makeItem({ library: { libraryType: 'user', editable: false, filesEditable: true } }),
				makeItem({ library: { libraryType: 'user', editable: true, filesEditable: false } }),
				makeItem({ isEditable: () => false }),
				makeItem({ deleted: true }),
				makeItem({ parentItem: { deleted: true } }),
			];

			for (let item of cases) {
				assert.isFalse(await Zotero.PDFWorker.canWriteAnnotationsToFile(item));
			}
			assert.isFalse(pathToFile.called);
		});
	});
});
