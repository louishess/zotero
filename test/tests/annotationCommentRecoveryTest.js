"use strict";

describe("Reader annotation recovery", function () {
	const STORAGE_MODE_PREF = 'reader.annotations.storageMode';
	let win;
	let sandbox;
	let attachment;
	let savedStorageMode;

	before(async function () {
		win = await loadZoteroPane();
	});

	after(function () {
		win?.Zotero_Tabs.closeAll();
		win?.close();
	});

	beforeEach(async function () {
		sandbox = sinon.createSandbox();
		savedStorageMode = saveUserPref(STORAGE_MODE_PREF);
		attachment = await importFileAttachment('test.pdf');
	});

	afterEach(async function () {
		try {
			await closeReadersForAttachment();
			await Zotero.Reader.waitForAnnotationRecovery();
			if (attachment && Zotero.Items.get(attachment.id)) {
				await Zotero.AnnotationStorageCoordinator.clearLocalState(attachment.id);
				await attachment.eraseTx();
			}
		}
		finally {
			sandbox?.restore();
			if (savedStorageMode) {
				restoreUserPref(STORAGE_MODE_PREF, savedStorageMode);
			}
			attachment = null;
		}
	});

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

	function cloneIntoReader(reader, value) {
		return Components.utils.cloneInto(
			JSON.parse(JSON.stringify(value)),
			reader._iframeWindow
		);
	}

	async function waitForReaderIdle(reader) {
		let manager = reader._internalReader._annotationManager;
		await waitForCallback(
			() => !manager._savingInProgress && !manager._unsavedAnnotations.size,
			500,
			10
		);
		await Zotero.Reader.waitForFileAnnotationMutations(reader.itemID);
	}

	async function addNote(reader, comment) {
		let manager = reader._internalReader._annotationManager;
		manager._skipAnnotationSavingDebounce = true;
		let annotation = manager.addAnnotation(cloneIntoReader(reader, {
			type: 'note',
			color: '#ffd400',
			comment,
			sortIndex: '00000|003305|00000',
			position: { pageIndex: 0, rects: [[50, 700, 72, 722]] }
		}));
		await waitForReaderIdle(reader);
		return annotation;
	}

	function updateComment(reader, id, comment) {
		reader._internalReader._annotationManager.updateAnnotations(
			cloneIntoReader(reader, [{ id, comment }])
		);
	}

	function failNextWorkerApply(message) {
		let originalApply = Zotero.PDFWorker.applyAnnotationChanges.bind(Zotero.PDFWorker);
		let failed = false;
		sandbox.stub(Zotero.PDFWorker, 'applyAnnotationChanges').callsFake(async (...args) => {
			if (!failed) {
				failed = true;
				let error = new Error(message);
				error.name = 'TransientAnnotationSaveError';
				throw error;
			}
			return originalApply(...args);
		});
		return originalApply;
	}

	async function closeReadersForAttachment() {
		if (!attachment) return;
		let readers = Zotero.Reader._readers.filter(reader => reader.itemID === attachment.id);
		for (let reader of readers) {
			try {
				reader.close();
			}
			catch (e) {}
		}
		await Zotero.Promise.delay(50);
		for (let reader of readers) {
			let index = Zotero.Reader._readers.indexOf(reader);
			if (index !== -1) {
				try {
					reader.uninit();
				}
				catch (e) {}
				Zotero.Reader._readers.splice(index, 1);
			}
		}
	}

	it('retains a failed local draft and retries it on explicit reload', async function () {
		this.timeout(30000);
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-and-zotero');
		let reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		let annotation = await addNote(reader, 'initial');
		let manager = reader._internalReader._annotationManager;
		let annotationID = annotation.id;
		let expectedToken = JSON.parse(JSON.stringify(reader._fileAnnotationFileToken));
		let expectedRevision = reader._fileAnnotationFileRevision;

		failNextWorkerApply('fail one PDF write');
		updateComment(reader, annotationID, 'transient draft');
		await waitForCallback(() => reader._fileAnnotationSaveFailed, 500, 10);
		await waitForReaderIdle(reader);

		assert.equal(manager._annotations.find(x => x.id === annotationID).comment, 'transient draft');
		assert.equal(reader._failedFileAnnotationDrafts.get(annotationID).comment, 'transient draft');
		assert.deepEqual(reader._fileAnnotationFileToken, expectedToken);
		assert.equal(reader._fileAnnotationFileRevision, expectedRevision);

		await reader.reload();
		let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		let native = attachment.getAnnotations().find(x => x.key === annotationID);
		assert.equal(pdf.annotations.find(x => x.id === annotationID).comment, 'transient draft');
		assert.equal(native.annotationComment, 'transient draft');
		assert.isFalse(reader._fileAnnotationSaveFailed);
		assert.isFalse(reader._failedFileAnnotationDrafts.has(annotationID));
		assert.isFalse(reader._fileAnnotationReadOnly);
		assert.equal(manager._annotations.find(x => x.id === annotationID).comment, 'transient draft');
	});

	it('preserves a failed draft when the PDF changes before retry', async function () {
		this.timeout(30000);
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-and-zotero');
		let reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		let annotation = await addNote(reader, 'initial');
		let manager = reader._internalReader._annotationManager;
		let annotationID = annotation.id;
		let expectedToken = JSON.parse(JSON.stringify(reader._fileAnnotationFileToken));
		let expectedRevision = reader._fileAnnotationFileRevision;
		let originalApply = failNextWorkerApply('fail before the external edit');

		updateComment(reader, annotationID, 'local draft');
		await waitForCallback(() => reader._fileAnnotationSaveFailed, 500, 10);
		await waitForReaderIdle(reader);

		let beforeExternal = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		let external = beforeExternal.annotations.find(x => x.id === annotationID);
		external = {
			...external,
			comment: 'external PDF edit',
			dateModified: new Date().toISOString()
		};
		await originalApply(
			attachment.id,
			{ upserts: [{ annotation: external }] },
			{ fileToken: beforeExternal.fileToken, fileRevision: beforeExternal.fileRevision },
			true
		);
		// The worker knows about its own write and can intentionally rebase an older
		// in-process token. Append bytes after that write to model a genuinely external
		// file replacement and force a new file identity.
		let path = await attachment.getFilePathAsync();
		let bytes = await IOUtils.read(path);
		let marker = new TextEncoder().encode('\n% external change\n');
		let changedBytes = new Uint8Array(bytes.length + marker.length);
		changedBytes.set(bytes);
		changedBytes.set(marker, bytes.length);
		await IOUtils.write(path, changedBytes);
		await Zotero.Reader.waitForAnnotationRecovery(attachment.id);

		let error = await getPromiseError(reader.reload());
		assert.isOk(error);
		assert.equal(error.name, 'FileChangedException');
		let afterExternal = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.equal(afterExternal.annotations.find(x => x.id === annotationID).comment, 'external PDF edit');
		assert.equal(manager._annotations.find(x => x.id === annotationID).comment, 'local draft');
		assert.equal(reader._failedFileAnnotationDrafts.get(annotationID).comment, 'local draft');
		assert.deepEqual(reader._fileAnnotationFileToken, expectedToken);
		assert.equal(reader._fileAnnotationFileRevision, expectedRevision);
		assert.isTrue(reader._fileAnnotationSaveFailed);
		assert.isTrue(reader._fileAnnotationReadOnly);
		assert.isTrue(manager._readOnly);
	});

	it('defers peer upserts and deletions while dirty, then converges after the draft drains', async function () {
		this.timeout(30000);
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-only');
		let reader1 = await Zotero.Reader.open(attachment.id);
		let reader2 = await Zotero.Reader.open(
			attachment.id,
			null,
			{ allowDuplicate: true, openInBackground: true }
		);
		await Promise.all([reader1._initPromise, reader2._initPromise]);
		let annotation1 = await addNote(reader1, 'first');
		let annotation2 = await addNote(reader1, 'second');
		await waitForCallback(
			() => reader2._fileAnnotations.has(annotation1.id) && reader2._fileAnnotations.has(annotation2.id),
			500,
			10
		);

		let manager2 = reader2._internalReader._annotationManager;
		manager2._skipAnnotationSavingDebounce = false;
		manager2._lastSaveTime = Date.now();
		manager2._lastChangeTime = Date.now();
		updateComment(reader2, annotation1.id, 'unsaved local edit');
		reader2._iframeWindow.clearTimeout(manager2._saveTimeout);
		manager2._saveTimeout = null;
		assert.isTrue(manager2._unsavedAnnotations.has(annotation1.id));
		let peerToken = JSON.stringify(reader2._fileAnnotationFileToken);

		updateComment(reader1, annotation1.id, 'peer upsert');
		await waitForReaderIdle(reader1);
		assert.equal(reader2._fileAnnotations.get(annotation1.id).comment, 'first');
		assert.equal(JSON.stringify(reader2._fileAnnotationFileToken), peerToken);

		reader1._internalReader._annotationManager.deleteAnnotations(
			cloneIntoReader(reader1, [annotation2.id])
		);
		await waitForReaderIdle(reader1);
		assert.isTrue(reader2._fileAnnotations.has(annotation2.id));
		assert.isTrue(Zotero.Reader._deferredAnnotationRecoveries.has(attachment.id));

		// Let the dirty peer perform its own save. The coordinator/worker can rebase
		// this known in-process write, after which deferred snapshot work must remove
		// the deletion from the peer as well.
		manager2._skipAnnotationSavingDebounce = true;
		await manager2._triggerSaving();
		await waitForReaderIdle(reader2);
		await Zotero.Promise.delay(0);
		await Zotero.Reader.waitForAnnotationRecovery(attachment.id);
		await waitForCallback(
			() => reader2._fileAnnotations.get(annotation1.id)?.comment === 'unsaved local edit'
				&& reader1._fileAnnotations.get(annotation1.id)?.comment === 'unsaved local edit'
				&& !reader1._fileAnnotations.has(annotation2.id)
				&& !reader2._fileAnnotations.has(annotation2.id),
			500,
			10
		);

		assert.equal(reader2._fileAnnotations.get(annotation1.id).comment, 'unsaved local edit');
		assert.equal(reader1._fileAnnotations.get(annotation1.id).comment, 'unsaved local edit');
		assert.equal(
			reader2._internalReader._annotationManager._annotations
				.find(x => x.id === annotation1.id).comment,
			'unsaved local edit'
		);
		assert.isFalse(
			reader2._internalReader._annotationManager._annotations.some(x => x.id === annotation2.id)
		);
		assert.isFalse(
			reader1._internalReader._annotationManager._annotations.some(x => x.id === annotation2.id)
		);
	});
});
