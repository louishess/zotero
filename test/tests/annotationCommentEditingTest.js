"use strict";

describe("Reader annotation comment editing", function () {
	const STORAGE_MODE_PREF = 'reader.annotations.storageMode';
	let win;
	let attachment;
	let reader;
	let sandbox;
	let savedStorageMode;
	let releaseWorkerWrite;
	let releaseNativeCommit;
	let notifierID;

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
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-and-zotero');
		attachment = await importFileAttachment('test.pdf');
	});

	afterEach(async function () {
		// Always unblock an in-flight test save before closing its reader.
		releaseWorkerWrite?.resolve();
		releaseNativeCommit?.resolve();
		let openReaders = Zotero.Reader._readers.filter(
			x => attachment && x.itemID === attachment.id
		);
		for (let openReader of openReaders) {
			try {
				await waitForReaderWrites(openReader);
			}
			catch (e) {
				// Preserve the test failure while still closing readers and cleaning up.
			}
		}
		if (notifierID) {
			Zotero.Notifier.unregisterObserver(notifierID);
			notifierID = null;
		}
		for (let openReader of openReaders) {
			try {
				openReader.close();
			}
			catch (e) {}
		}
		try {
			if (attachment && Zotero.Items.get(attachment.id)) {
				await Zotero.AnnotationStorageCoordinator.clearLocalState(attachment.id);
				await attachment.eraseTx();
			}
		}
		finally {
			sandbox?.restore();
			await Zotero.Reader.waitForAnnotationRecovery();
			if (savedStorageMode) {
				restoreUserPref(STORAGE_MODE_PREF, savedStorageMode);
			}
			reader = null;
			attachment = null;
			releaseWorkerWrite = null;
			releaseNativeCommit = null;
		}
	});

	async function waitForReaderWrites(targetReader) {
		let manager = targetReader._internalReader._annotationManager;
		await waitForCallback(
			() => !manager._savingInProgress && !manager._unsavedAnnotations.size,
			20,
			20
		);
		await targetReader._fileAnnotationMutationPromise;
		await Zotero.Reader.waitForFileAnnotationMutations(targetReader.itemID);
	}

	async function assertFreshRecoveryPreservesUndoHistory(targetReader, annotationID) {
		let manager = targetReader._internalReader._annotationManager;
		let historyLength = manager._undoStack.length;
		assert.isAbove(historyLength, 0, 'the edited annotation should have undo history before refresh');
		let comment = manager._annotations.find(item => item.id === annotationID).comment;
		let result = await Zotero.Reader._queueAnnotationRecovery(targetReader.itemID, 'file-notification');
		await Zotero.Reader.waitForAnnotationRecovery(targetReader.itemID);
		assert.isNotOk(result?.error, 'the identical background refresh should complete successfully');
		assert.equal(manager._undoStack.length, historyLength, 'an identical fresh snapshot must preserve undo history');
		assert.equal(manager._annotations.find(item => item.id === annotationID).comment, comment);
	}

	async function openCommentEditor(targetReader, id, surface) {
		let internal = targetReader._internalReader;
		let doc = targetReader._iframeWindow.document;
		if (surface === 'sidebar') {
			internal.setSidebarView('annotations');
			internal.toggleSidebar(true);
			internal.setSelectedAnnotations(Components.utils.cloneInto([id], targetReader._iframeWindow));
			return waitForCallback(
				() => doc.querySelector(`[data-sidebar-annotation-id="${id}"] .comment [contenteditable="true"]`),
				20,
				10
			);
		}

		internal.toggleSidebar(false);
		await internal._primaryView.initializedPromise;
		let pdfWindow = internal._primaryView._iframeWindow;
		let pdfApplication = pdfWindow.PDFViewerApplication;
		let pdfViewer = pdfApplication.pdfViewer;
		await pdfApplication.initializedPromise;
		await pdfViewer.pagesPromise;
		await waitForCallback(() => pdfViewer._pages[0]?.viewport);
		internal._primaryView.setSelectedAnnotationIDs(
			Components.utils.cloneInto([id], targetReader._iframeWindow)
		);
		internal._primaryView._openAnnotationPopup();
		return waitForCallback(
			() => doc.querySelector('.annotation-popup .comment [contenteditable="true"]'),
			20,
			10
		);
	}

	function getCommentEditor(targetReader, id, surface) {
		let doc = targetReader._iframeWindow.document;
		return surface === 'sidebar'
			? doc.querySelector(`[data-sidebar-annotation-id="${id}"] .comment [contenteditable="true"]`)
			: doc.querySelector('.annotation-popup .comment [contenteditable="true"]');
	}

	function appendEditorText(editor, text) {
		let doc = editor.ownerDocument;
		let win = doc.defaultView;
		editor.focus();
		let range = doc.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		let selection = win.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		for (let character of text) {
			if (!doc.execCommand('insertText', false, character)) {
				throw new Error('Gecko could not insert text into the comment editor');
			}
		}
	}

	function pasteEditorHTML(editor, html) {
		let doc = editor.ownerDocument;
		let window = doc.defaultView;
		editor.focus();
		editor.innerHTML = html;
		let event = typeof window.InputEvent === 'function'
			? new window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })
			: new window.Event('input', { bubbles: true });
		editor.dispatchEvent(event);
	}

	function deleteEditorText(editor) {
		let doc = editor.ownerDocument;
		let window = doc.defaultView;
		editor.focus();
		let range = doc.createRange();
		range.selectNodeContents(editor);
		let selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		if (!doc.execCommand('delete')) {
			throw new Error('Gecko could not delete comment editor text');
		}
	}

	async function waitForReaderFrame(targetReader) {
		let readerWindow = targetReader._iframeWindow;
		await new Promise(resolve => readerWindow.requestAnimationFrame(resolve));
		await new Promise(resolve => readerWindow.requestAnimationFrame(resolve));
	}

	function observeCoordinatorNativeNotification(targetReader, annotationKey, onNotification) {
		let notification = Zotero.Promise.defer();
		notifierID = Zotero.Notifier.registerObserver({
			notify(event, type, ids, extraData) {
				let annotationID = ids.find(id => (
					type === 'item'
					&& ['add', 'modify'].includes(event)
					&& extraData?.[id]?.annotationStorageCoordinator
				));
				if (!annotationID) {
					return;
				}
				let annotation = Zotero.Items.getByLibraryAndKey(
					targetReader._item.libraryID,
					annotationKey
				);
				if (annotation?.id === annotationID) {
					onNotification();
					notification.resolve({ event, annotationID });
				}
			}
		}, ['item'], 'annotation-comment-edit-test', 200);
		return notification.promise;
	}

	function pauseDualSaveAfterPDFWrite(targetReader, annotationID, matches) {
		let workerWriteFinished = Zotero.Promise.defer();
		let nativeCommitReached = Zotero.Promise.defer();
		let nativeSnapshotApplied = Zotero.Promise.defer();
		let releaseWorker = Zotero.Promise.defer();
		let releaseNativeCommitBarrier = Zotero.Promise.defer();
		let coordinatorNotificationSeen = false;
		let nativeSnapshotScheduled = false;
		let nativeSnapshotComment = null;
		let pauseWorker = true;
		let pauseCommit = true;

		releaseWorkerWrite = releaseWorker;
		releaseNativeCommit = releaseNativeCommitBarrier;
		let nativeNotificationDelivered = observeCoordinatorNativeNotification(
			targetReader,
			annotationID,
			() => coordinatorNotificationSeen = true
		);
		let originalApply = Zotero.PDFWorker.applyAnnotationChanges.bind(Zotero.PDFWorker);
		sandbox.stub(Zotero.PDFWorker, 'applyAnnotationChanges').callsFake(async (
			itemID,
			changes,
			...rest
		) => {
			let result = await originalApply(itemID, changes, ...rest);
			if (pauseWorker && itemID === attachment.id && matches(changes)) {
				pauseWorker = false;
				workerWriteFinished.resolve();
				await releaseWorker.promise;
			}
			return result;
		});

		let readerPrototype = Object.getPrototypeOf(targetReader);
		while (!Object.prototype.hasOwnProperty.call(readerPrototype, 'setAnnotations')) {
			readerPrototype = Object.getPrototypeOf(readerPrototype);
		}
		let originalSetAnnotations = readerPrototype.setAnnotations;
		sandbox.stub(readerPrototype, 'setAnnotations').callsFake(async function (items) {
			let nativeAnnotation = items.find(item => item.key === annotationID);
			if (nativeAnnotation) {
				nativeSnapshotScheduled = true;
				nativeSnapshotComment = nativeAnnotation.annotationComment;
			}
			let result = await originalSetAnnotations.call(this, items);
			if (nativeAnnotation) {
				nativeSnapshotApplied.resolve();
			}
			return result;
		});

		let originalCommit = Zotero.Notifier.commit.bind(Zotero.Notifier);
		sandbox.stub(Zotero.Notifier, 'commit').callsFake(async (...args) => {
			let result = await originalCommit(...args);
			if (pauseCommit && coordinatorNotificationSeen) {
				pauseCommit = false;
				if (nativeSnapshotScheduled) {
					await nativeSnapshotApplied.promise;
				}
				nativeCommitReached.resolve();
				await releaseNativeCommitBarrier.promise;
			}
			return result;
		});

		return {
			workerWriteFinished: workerWriteFinished.promise,
			nativeCommitReached: nativeCommitReached.promise,
			nativeNotificationDelivered,
			releaseWorker: () => releaseWorker.resolve(),
			releaseNativeCommit: () => releaseNativeCommitBarrier.resolve(),
			get coordinatorNotificationSeen() { return coordinatorNotificationSeen; },
			get nativeSnapshotScheduled() { return nativeSnapshotScheduled; },
			get nativeSnapshotComment() { return nativeSnapshotComment; }
		};
	}

	async function createNote(targetReader, comment = '') {
		targetReader._internalReader._annotationManager._skipAnnotationSavingDebounce = true;
		let annotation = targetReader._internalReader._annotationManager.addAnnotation(
			Components.utils.cloneInto({
				type: 'note',
				color: '#ffd400',
				sortIndex: '00000|003305|00000',
				comment,
				position: { pageIndex: 0, rects: [[50, 700, 72, 722]] }
			}, targetReader._iframeWindow)
		);
		await waitForReaderWrites(targetReader);
		await Zotero.Reader.waitForAnnotationRecovery();
		return annotation;
	}

	async function exerciseDelayedDualCommentEdit(surface, testContext) {
		testContext.timeout(30000);
		reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		assert.isTrue(reader._fileAnnotationMode);
		assert.equal(reader._annotationStorageMode, 'pdf-and-zotero');

		let annotation = await createNote(reader);
		let annotationID = String(annotation.id);
		let editor = await openCommentEditor(reader, annotationID, surface);
		let writeFinishedInWorker = Zotero.Promise.defer();
		let coordinatorNotificationSeen = false;
		let nativeNotificationDelivered = observeCoordinatorNativeNotification(
			reader,
			annotationID,
			() => coordinatorNotificationSeen = true
		);
		let originalApply = Zotero.PDFWorker.applyAnnotationChanges.bind(Zotero.PDFWorker);
		let pauseWorker = true;
		releaseWorkerWrite = Zotero.Promise.defer();
		sandbox.stub(Zotero.PDFWorker, 'applyAnnotationChanges').callsFake(async (
			itemID,
			changes,
			...rest
		) => {
			let result = await originalApply(itemID, changes, ...rest);
			let comment = changes.upserts?.[0]?.annotation?.comment;
			if (pauseWorker && itemID === attachment.id && comment === 'A') {
				pauseWorker = false;
				writeFinishedInWorker.resolve();
				await releaseWorkerWrite.promise;
			}
			return result;
		});

		let originalCommit = Zotero.Notifier.commit.bind(Zotero.Notifier);
		let pauseCommit = true;
		releaseNativeCommit = Zotero.Promise.defer();
		let nativeCommitReached = Zotero.Promise.defer();
		let nativeSnapshotScheduled = false;
		let nativeSnapshotComment = null;
		let nativeSnapshotApplied = Zotero.Promise.defer();
		let readerPrototype = Object.getPrototypeOf(reader);
		while (!Object.prototype.hasOwnProperty.call(readerPrototype, 'setAnnotations')) {
			readerPrototype = Object.getPrototypeOf(readerPrototype);
		}
		let originalSetAnnotations = readerPrototype.setAnnotations;
		sandbox.stub(readerPrototype, 'setAnnotations').callsFake(async function (items) {
			let nativeAnnotation = items.find(item => item.key === annotationID);
			if (nativeAnnotation) {
				nativeSnapshotScheduled = true;
				nativeSnapshotComment = nativeAnnotation.annotationComment;
			}
			let result = await originalSetAnnotations.call(this, items);
			if (nativeAnnotation) {
				nativeSnapshotApplied.resolve();
			}
			return result;
		});
		sandbox.stub(Zotero.Notifier, 'commit').callsFake(async (...args) => {
			let result = await originalCommit(...args);
			if (pauseCommit && coordinatorNotificationSeen) {
				pauseCommit = false;
				if (nativeSnapshotScheduled) {
					await nativeSnapshotApplied.promise;
				}
				nativeCommitReached.resolve();
				await releaseNativeCommit.promise;
			}
			return result;
		});

		appendEditorText(editor, 'A');
		await writeFinishedInWorker.promise;
		// The PDF worker has finished the older save, but native mirroring and its
		// notification remain behind the worker barrier.
		appendEditorText(getCommentEditor(reader, annotationID, surface), 'B');
		assert.equal(getCommentEditor(reader, annotationID, surface).innerText, 'AB');
		assert.equal(
			reader._internalReader._annotationManager._unsavedAnnotations.get(annotationID).comment,
			'AB'
		);
		let manager = reader._internalReader._annotationManager;
		let historyLengthBeforeNativeEcho = manager._undoStack.length;
		assert.isAbove(historyLengthBeforeNativeEcho, 0, 'typing should create undo history');

		releaseWorkerWrite.resolve();
		await nativeCommitReached.promise;
		await nativeNotificationDelivered;
		await waitForReaderFrame(reader);
		let managerComment = manager._annotations.find(item => item.id === annotationID)?.comment;
		let pendingComment = manager._unsavedAnnotations.get(annotationID)?.comment;
		let nativeComment = attachment.getAnnotations()
			.find(item => item.key === annotationID)?.annotationComment;
		assert.isTrue(coordinatorNotificationSeen, 'the coordinator-owned native notification reached this attachment');
		assert.equal(nativeComment, 'A', 'the native row must still contain the older saved comment');
		if (nativeSnapshotScheduled) {
			assert.equal(nativeSnapshotComment, 'A', 'the notification payload must be the older snapshot');
		}

		// The first native snapshot contains only A. It must not replace the live
		// editor or its queued draft while the save callback is still in flight.
		assert.equal(getCommentEditor(reader, annotationID, surface).innerText, 'AB');
		assert.equal(managerComment, 'AB', 'the annotation manager must retain the visible draft');
		assert.equal(pendingComment, 'AB', 'the manager must still queue the complete unsaved draft');
		assert.equal(
			manager._unsavedAnnotations.get(annotationID).comment,
			'AB'
		);
		assert.equal(
			manager._undoStack.length,
			historyLengthBeforeNativeEcho,
			'the older native echo must preserve the live draft undo history'
		);
		appendEditorText(getCommentEditor(reader, annotationID, surface), 'C');
		assert.equal(getCommentEditor(reader, annotationID, surface).innerText, 'ABC');
		assert.equal(
			reader._internalReader._annotationManager._unsavedAnnotations.get(annotationID).comment,
			'ABC'
		);

		releaseNativeCommit.resolve();
		await waitForReaderWrites(reader);
		let native = attachment.getAnnotations().find(item => item.key === annotationID);
		let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.equal(native.annotationComment, 'ABC');
		assert.equal(pdf.annotations.find(item => item.id === annotationID).comment, 'ABC');
		await assertFreshRecoveryPreservesUndoHistory(reader, annotationID);

		reader.close();
		reader = null;
		reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		assert.equal(
			reader._internalReader._annotationManager._annotations.find(item => item.id === annotationID).comment,
			'ABC'
		);
		assert.equal(reader._fileAnnotations.get(annotationID).comment, 'ABC');
	}

	it('should preserve a live sidebar comment when an older Dual-mode native notification arrives', async function () {
		await exerciseDelayedDualCommentEdit('sidebar', this);
	});

	it('should preserve a live popup comment when an older Dual-mode native notification arrives', async function () {
		await exerciseDelayedDualCommentEdit('popup', this);
	});

	for (let surface of ['sidebar', 'popup']) {
		it(`should keep an empty ${surface} rich-text draft after a debounced Dual-mode save, undo, and redo`, async function () {
			this.timeout(30000);
			reader = await Zotero.Reader.open(attachment.id);
			await reader._initPromise;
			assert.equal(reader._annotationStorageMode, 'pdf-and-zotero');
			let annotation = await createNote(reader);
			let annotationID = String(annotation.id);
			let editor = await openCommentEditor(reader, annotationID, surface);
			let manager = reader._internalReader._annotationManager;
			manager._skipAnnotationSavingDebounce = false;
			let barriers = pauseDualSaveAfterPDFWrite(reader, annotationID, changes => (
				changes.upserts?.[0]?.annotation?.comment?.includes('<b>')
			));

			pasteEditorHTML(editor, 'first line<br><b>second line</b>');
			await barriers.workerWriteFinished;
			let richComment = manager._annotations.find(item => item.id === annotationID).comment;
			assert.include(richComment, '\n');
			assert.include(richComment, '<b>');
			assert.equal(manager._unsavedAnnotations.size, 0, 'the first draft moved into the debounced save');

			// Exercise undo and redo while that older PDF write is still active. The
			// final user action deletes all text, leaving an explicit empty draft.
			assert.isTrue(manager.undo());
			await waitForReaderFrame(reader);
			assert.equal(manager._annotations.find(item => item.id === annotationID).comment, '');
			assert.isTrue(manager.redo());
			await waitForReaderFrame(reader);
			assert.equal(manager._annotations.find(item => item.id === annotationID).comment, richComment);
			deleteEditorText(getCommentEditor(reader, annotationID, surface));
			assert.equal(manager._annotations.find(item => item.id === annotationID).comment, '');
			assert.equal(manager._unsavedAnnotations.get(annotationID).comment, '');

			barriers.releaseWorker();
			await barriers.nativeCommitReached;
			await barriers.nativeNotificationDelivered;
			await waitForReaderFrame(reader);
			assert.isTrue(barriers.coordinatorNotificationSeen);
			if (barriers.nativeSnapshotScheduled) {
				assert.equal(barriers.nativeSnapshotComment, richComment);
			}
			assert.equal(getCommentEditor(reader, annotationID, surface).innerText.trim(), '');
			assert.equal(manager._annotations.find(item => item.id === annotationID).comment, '');
			assert.equal(manager._unsavedAnnotations.get(annotationID).comment, '');

			appendEditorText(getCommentEditor(reader, annotationID, surface), 'kept');
			assert.equal(getCommentEditor(reader, annotationID, surface).innerText, 'kept');
			assert.equal(manager._unsavedAnnotations.get(annotationID).comment, 'kept');
			barriers.releaseNativeCommit();
			await waitForReaderWrites(reader);
			assert.equal(attachment.getAnnotations().find(item => item.key === annotationID).annotationComment, 'kept');
			let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.equal(pdf.annotations.find(item => item.id === annotationID).comment, 'kept');
			await assertFreshRecoveryPreservesUndoHistory(reader, annotationID);
		});
	}

	it('should round-trip pasted rich text and empty comments in Standard mode, including undo and redo', async function () {
		this.timeout(30000);
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'standard');
		reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		assert.isFalse(reader._fileAnnotationMode);
		let annotation = await createNote(reader);
		let annotationID = String(annotation.id);
		let editor = await openCommentEditor(reader, annotationID, 'sidebar');
		pasteEditorHTML(editor, 'first line<br><b>second line</b>');
		let manager = reader._internalReader._annotationManager;
		let richComment = manager._annotations.find(item => item.id === annotationID).comment;
		assert.include(richComment, 'first line');
		assert.include(richComment, 'second line');
		assert.include(richComment, '<b>');
		await waitForReaderWrites(reader);
		let native = attachment.getAnnotations().find(item => item.key === annotationID);
		assert.equal(native.annotationComment, richComment);
		let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.isFalse(pdf.annotations.some(item => item.id === annotationID));

		assert.isTrue(manager.undo(), 'undo should restore the previous empty comment');
		await waitForReaderWrites(reader);
		assert.equal(attachment.getAnnotations().find(item => item.key === annotationID).annotationComment || '', '');
		assert.isTrue(manager.redo(), 'redo should restore the rich comment');
		await waitForReaderWrites(reader);
		assert.equal(attachment.getAnnotations().find(item => item.key === annotationID).annotationComment, richComment);

		deleteEditorText(getCommentEditor(reader, annotationID, 'sidebar'));
		await waitForReaderWrites(reader);
		assert.equal(manager._annotations.find(item => item.id === annotationID).comment, '');
		assert.equal(attachment.getAnnotations().find(item => item.key === annotationID).annotationComment || '', '');
		manager.deleteAnnotations(Components.utils.cloneInto([annotationID], reader._iframeWindow));
		await waitForReaderWrites(reader);
		assert.isFalse(attachment.getAnnotations().some(item => item.key === annotationID));
		pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.isFalse(pdf.annotations.some(item => item.id === annotationID));
	});

	it('should keep PDF-only comment edits and deletions in the PDF', async function () {
		this.timeout(30000);
		Zotero.Prefs.set(STORAGE_MODE_PREF, 'pdf-only');
		reader = await Zotero.Reader.open(attachment.id);
		await reader._initPromise;
		assert.isTrue(reader._fileAnnotationMode);
		assert.equal(reader._annotationStorageMode, 'pdf-only');
		let annotation = await createNote(reader);
		let annotationID = String(annotation.id);
		await openCommentEditor(reader, annotationID, 'popup');
		appendEditorText(getCommentEditor(reader, annotationID, 'popup'), 'file backed');
		await waitForReaderWrites(reader);
		assert.lengthOf(attachment.getAnnotations(), 0);
		let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.equal(pdf.annotations.find(item => item.id === annotationID).comment, 'file backed');

		deleteEditorText(getCommentEditor(reader, annotationID, 'popup'));
		await waitForReaderWrites(reader);
		pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.equal(pdf.annotations.find(item => item.id === annotationID).comment, '');
		reader._internalReader._annotationManager.deleteAnnotations(
			Components.utils.cloneInto([annotationID], reader._iframeWindow)
		);
		await waitForReaderWrites(reader);
		pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		assert.isFalse(pdf.annotations.some(item => item.id === annotationID));
		assert.lengthOf(attachment.getAnnotations(), 0);
	});
});
