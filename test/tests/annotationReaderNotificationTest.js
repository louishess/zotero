"use strict";

describe('Reader annotation notifications', function () {
	let sandbox;
	let previousReaders;
	let attachments;

	function result() {
		return {
			effectiveMode: 'pdf-and-zotero',
			appliedMode: 'pdf-and-zotero',
			annotations: [],
			fileToken: { size: 1, lastModified: 1 },
			fileRevision: 1,
			sources: {},
			conflicts: []
		};
	}

	function makeReader(itemID, closed = false) {
		return {
			itemID,
			_item: Zotero.Items.get(itemID),
			_fileAnnotationMode: true,
			_isTabClosed: closed,
			_fileAnnotations: new Map(),
			_fileAnnotationSources: new Map(),
			annotationItemIDs: [],
			updateTitle: sandbox.stub().resolves(),
			displayError: sandbox.stub(),
			_applyFileAnnotationResult: sandbox.stub().callsFake(value => value),
			_resolveAnnotationStorageConflicts: sandbox.stub().callsFake(value => value),
			receiveFileAnnotationChanges: sandbox.stub()
		};
	}

	beforeEach(async function () {
		sandbox = sinon.createSandbox();
		previousReaders = Zotero.Reader._readers;
		attachments = await Promise.all([
			importFileAttachment('test.pdf'),
			importFileAttachment('test.pdf')
		]);
		await Zotero.Reader.waitForAnnotationRecovery();
		Zotero.Reader._readers = [
			makeReader(attachments[0].id),
			makeReader(attachments[1].id, true)
		];
		sandbox.stub(Zotero.AnnotationStorageCoordinator, 'withAttachmentLock')
			.callsFake((itemID, operation) => operation({ keys: new Set([String(itemID)]) }));
		sandbox.stub(Zotero.AnnotationStorageCoordinator, 'reconcile')
			.callsFake(async () => result());
		sandbox.stub(Zotero.AnnotationStorageCoordinator, 'getAttachmentIDsForAnnotationIDs')
			.resolves([]);
		sandbox.stub(Zotero.PDFWorker, 'getEffectiveAnnotationStorageMode')
			.resolves('pdf-and-zotero');
	});

	afterEach(async function () {
		Zotero.Reader._readers = previousReaders;
		sandbox.restore();
		for (let attachment of attachments || []) {
			if (Zotero.Items.get(attachment.id)) await attachment.eraseTx();
		}
		await Zotero.Reader.waitForAnnotationRecovery();
	});

	it('reconciles every PDF in a mixed batch, including a closed reader', async function () {
		Zotero.Reader._annotationFilePollState.set(attachments[1].id, { status: 'conflict' });
		Zotero.Reader.notify(
			'modify',
			'item',
			attachments.map(attachment => attachment.id),
			{}
		);
		await Zotero.Reader.waitForAnnotationRecovery();

		assert.isFalse(Zotero.Reader._annotationFilePollState.has(attachments[1].id));
		assert.deepEqual(
			Zotero.AnnotationStorageCoordinator.reconcile.getCalls().map(call => call.args[0]),
			attachments.map(attachment => attachment.id)
		);
		sinon.assert.calledOnce(Zotero.Reader._readers[0]._applyFileAnnotationResult);
		sinon.assert.calledOnce(Zotero.Reader._readers[0]._resolveAnnotationStorageConflicts);
		assert.isFalse(Zotero.Reader._readers[0]._resolveAnnotationStorageConflicts.firstCall.args[1].interactive);
		// Refresh a retained closed reader as well, but never broadcast its result.
		sinon.assert.calledOnce(Zotero.Reader._readers[1]._applyFileAnnotationResult);
		assert.deepEqual(
			Zotero.Reader._readers[1]._applyFileAnnotationResult.firstCall.args[2],
			{ broadcast: false }
		);
		sinon.assert.notCalled(Zotero.Reader._readers[1]._resolveAnnotationStorageConflicts);
	});

	it('defers manager-owned replacement notifications until state transfer completes', async function () {
		Zotero.Reader.notify('add', 'item', [attachments[1].id], {
			[attachments[1].id]: { linkedFolderAttachmentManager: true }
		});
		await Zotero.Reader.waitForAnnotationRecovery();
		sinon.assert.notCalled(Zotero.AnnotationStorageCoordinator.reconcile);
	});

	it('does not treat native data notifications as PDF-only changes', async function () {
		Zotero.PDFWorker.getEffectiveAnnotationStorageMode.resolves('pdf-only');
		Zotero.Reader.notify('modify', 'item', [attachments[0].id], {});
		await Zotero.Reader.waitForAnnotationRecovery();
		sinon.assert.notCalled(Zotero.AnnotationStorageCoordinator.reconcile);
	});

	it('does not replace unsaved iframe annotations from a background snapshot', async function () {
		let reader = Zotero.Reader._readers[0];
		reader._internalReader = {
			_annotationManager: {
				_unsavedAnnotations: new Map([['pending', {}]]),
				_savingInProgress: false
			}
		};
		Zotero.Reader.notify('modify', 'file', [attachments[0].id], {});
		await Zotero.Reader.waitForAnnotationRecovery();
		sinon.assert.notCalled(Zotero.AnnotationStorageCoordinator.reconcile);
	});

	it('rechecks iframe edits that arrive while background reconcile is waiting', async function () {
		let reader = Zotero.Reader._readers[0];
		let reconcileStarted = Zotero.Promise.defer();
		let releaseReconcile = Zotero.Promise.defer();
		Zotero.AnnotationStorageCoordinator.reconcile.callsFake(async () => {
			reconcileStarted.resolve();
			await releaseReconcile.promise;
			return result();
		});

		Zotero.Reader.notify('modify', 'file', [reader.itemID], {});
		await reconcileStarted.promise;
		reader._internalReader = {
			_annotationManager: {
				_unsavedAnnotations: new Map([['during-reconcile', {}]]),
				_savingInProgress: false
			}
		};
		releaseReconcile.resolve();
		await Zotero.Reader.waitForAnnotationRecovery();

		sinon.assert.notCalled(reader._applyFileAnnotationResult);
	});

	it('uses durable annotation state to find a closed attachment after deletion', async function () {
		let annotation = await Zotero.Annotations.saveFromJSON(attachments[1], {
			key: 'CLSDABCD',
			type: 'note',
			comment: 'closed annotation',
			color: '#ffd400',
			position: { pageIndex: 0, rects: [[50, 700, 72, 722]] },
			sortIndex: '00000|000000|00000',
			tags: []
		});
		await Zotero.Reader.waitForAnnotationRecovery();
		await annotation.eraseTx();
		await Zotero.Reader.waitForAnnotationRecovery();
		for (let reader of Zotero.Reader._readers) {
			reader._applyFileAnnotationResult.resetHistory();
			reader._resolveAnnotationStorageConflicts.resetHistory();
		}
		Zotero.AnnotationStorageCoordinator.reconcile.resetHistory();
		Zotero.AnnotationStorageCoordinator.getAttachmentIDsForAnnotationIDs.resetHistory();
		let annotationKey = annotation.key;
		Zotero.AnnotationStorageCoordinator.getAttachmentIDsForAnnotationIDs
			.resolves([attachments[1].id]);
		Zotero.Reader.notify('delete', 'item', [annotation.id], {
			[annotation.id]: { libraryID: attachments[1].libraryID, key: annotationKey }
		});
		await Zotero.Reader.waitForAnnotationRecovery();

		assert.deepEqual(
			Zotero.AnnotationStorageCoordinator.reconcile.getCalls().map(call => call.args[0]),
			[attachments[1].id]
		);
		assert.deepEqual(
			Zotero.AnnotationStorageCoordinator.getAttachmentIDsForAnnotationIDs.firstCall.args[0],
			[{ libraryID: attachments[1].libraryID, key: annotationKey }]
		);
		assert.isTrue(Zotero.Reader._readers[1]._isTabClosed);
		sinon.assert.calledOnce(Zotero.Reader._readers[1]._applyFileAnnotationResult);
	});
});

describe('Reader attachment open reservation', function () {
	let win;
	let sandbox;
	let attachment;

	before(async function () {
		win = await loadZoteroPane();
	});

	after(function () {
		win?.Zotero_Tabs.closeAll();
		win?.close();
	});

	beforeEach(async function () {
		sandbox = sinon.createSandbox();
		attachment = await importFileAttachment('test.pdf');
		Zotero.Prefs.set('reader.annotations.storageMode', 'standard');
	});

	afterEach(async function () {
		sandbox.restore();
		for (let reader of Zotero.Reader._readers.filter(reader => (
			attachment && reader.itemID === attachment.id
		))) {
			try {
				reader.close();
			}
			catch (e) {}
		}
		await Zotero.Reader.waitForAnnotationRecovery();
		if (attachment && Zotero.Items.get(attachment.id)) {
			await attachment.eraseTx();
		}
	});

	it('holds the real reader open reservation until initialization completes', async function () {
		let initializationStarted = Zotero.Promise.defer();
		let releaseInitialization = Zotero.Promise.defer();
		let reader;
		let originalLoadAll = Zotero.SyncedSettings.loadAll;
		let paused = false;
		sandbox.stub(Zotero.PDFWorker, 'canUseFileAnnotations').resolves(true);
		sandbox.stub(Zotero.SyncedSettings, 'loadAll').callsFake(async (...args) => {
			if (!paused) {
				paused = true;
				initializationStarted.resolve();
				await releaseInitialization.promise;
			}
			return originalLoadAll.apply(Zotero.SyncedSettings, args);
		});

		let opening = Zotero.Reader.open(
			attachment.id,
			null,
			{ openInBackground: true }
		);
		await initializationStarted.promise;

		let migrationStarted = false;
		let migration = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
			attachment.id,
			async () => {
				migrationStarted = true;
			}
		);
		await Zotero.Promise.delay(20);
		assert.isFalse(migrationStarted, 'migration must wait for reader initialization');

		releaseInitialization.resolve();
		reader = await opening;
		await migration;
		assert.isTrue(migrationStarted);

		reader.close();
		await Zotero.Promise.delay(100);
	});
});

describe('Reader linked PDF polling', function () {
	let sandbox;
	let article;
	let attachments;
	let baseDirectory;
	let previousBasePath;
	let previousRelativePathPreference;
	let previousStorageMode;
	let previousManagerEnabled;
	let hadBasePath;
	let hadRelativePathPreference;
	let hadStorageMode;
	let hadManagerEnabled;
	let pollingWasActive;

	function makeAnnotation(id, comment, y) {
		return {
			id,
			type: 'note',
			color: '#ffd400',
			comment,
			authorName: 'Linked PDF polling test',
			dateModified: '2026-01-02T03:04:05.000Z',
			sortIndex: '00000|000000|00000',
			tags: [],
			pageLabel: '1',
			position: { pageIndex: 0, rects: [[50, y, 72, y + 22]] }
		};
	}

	async function writePDFAnnotation(attachment, annotation) {
		let before = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
		await Zotero.PDFWorker.applyAnnotationChanges(
			attachment.id,
			{ upserts: [{ annotation }] },
			{ fileToken: before.fileToken, fileRevision: before.fileRevision },
			true
		);
	}

	beforeEach(async function () {
		sandbox = sinon.createSandbox();
		hadBasePath = Zotero.Prefs.prefHasUserValue('baseAttachmentPath');
		previousBasePath = Zotero.Prefs.get('baseAttachmentPath');
		hadRelativePathPreference = Zotero.Prefs.prefHasUserValue('saveRelativeAttachmentPath');
		previousRelativePathPreference = Zotero.Prefs.get('saveRelativeAttachmentPath');
		hadStorageMode = Zotero.Prefs.prefHasUserValue('reader.annotations.storageMode');
		previousStorageMode = Zotero.Prefs.get('reader.annotations.storageMode');
		hadManagerEnabled = Zotero.Prefs.prefHasUserValue('linkedFolderAttachments.enabled');
		previousManagerEnabled = Zotero.Prefs.get('linkedFolderAttachments.enabled');
		pollingWasActive = !!Zotero.Reader._annotationFilePollTimer;
		await Zotero.Reader._stopAnnotationFilePolling();
		baseDirectory = await getTempDirectory();
		Zotero.Prefs.set('baseAttachmentPath', baseDirectory);
		Zotero.Prefs.set('saveRelativeAttachmentPath', true);
		Zotero.Prefs.set('reader.annotations.storageMode', 'pdf-and-zotero');
		Zotero.Prefs.set('linkedFolderAttachments.enabled', false);
		article = await createDataObject('item', { itemType: 'journalArticle' });
		let paths = ['poll-one.pdf', 'poll-two.pdf'];
		attachments = [];
		for (let path of paths) {
			let destination = PathUtils.join(baseDirectory, path);
			await IOUtils.copy(
				PathUtils.join(getTestDataDirectory().path, 'test.pdf'),
				destination
			);
			attachments.push(await Zotero.Attachments.linkFromFileWithRelativePath({
				path,
				title: path,
				contentType: 'application/pdf',
				parentItemID: article.id
			}));
		}
		Zotero.Reader._startAnnotationFilePolling();
	});

	afterEach(async function () {
		await Zotero.Reader._stopAnnotationFilePolling();
		sandbox.restore();
		for (let attachment of attachments || []) {
			try {
				await Zotero.AnnotationStorageCoordinator.clearLocalState(attachment.id);
			}
			catch (error) {}
		}
		if (article && Zotero.Items.get(article.id)) await article.eraseTx();
		if (baseDirectory) {
			await IOUtils.remove(baseDirectory, { recursive: true, ignoreAbsent: true });
		}
		if (hadBasePath) Zotero.Prefs.set('baseAttachmentPath', previousBasePath);
		else Zotero.Prefs.clear('baseAttachmentPath');
		if (hadRelativePathPreference) {
			Zotero.Prefs.set('saveRelativeAttachmentPath', previousRelativePathPreference);
		}
		else Zotero.Prefs.clear('saveRelativeAttachmentPath');
		if (hadStorageMode) {
			Zotero.Prefs.set('reader.annotations.storageMode', previousStorageMode);
		}
		else Zotero.Prefs.clear('reader.annotations.storageMode');
		if (hadManagerEnabled) {
			Zotero.Prefs.set('linkedFolderAttachments.enabled', previousManagerEnabled);
		}
		else Zotero.Prefs.clear('linkedFolderAttachments.enabled');
		if (pollingWasActive) Zotero.Reader._startAnnotationFilePolling();
	});

	it('reconciles changed closed linked PDFs without a Zotero notification', async function () {
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		await Zotero.Reader.waitForAnnotationRecovery();
		let notify = sandbox.spy(Zotero.Reader, 'notify');
		for (let [index, attachment] of attachments.entries()) {
			let id = Zotero.DataObjectUtilities.generateKey();
			let before = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			await Zotero.PDFWorker.applyAnnotationChanges(
				attachment.id,
				{ upserts: [{ annotation: makeAnnotation(id, `external ${index}`, 700 - index * 40) }] },
				{ fileToken: before.fileToken, fileRevision: before.fileRevision },
				true
			);
			if (index === 0) await Zotero.Promise.delay(10);
		}
		assert.isFalse(notify.called, 'the test changed bytes directly without a Zotero notification');

		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		for (let attachment of attachments) {
			let annotations = attachment.getAnnotations().filter(annotation => !annotation.annotationIsExternal);
			assert.lengthOf(annotations, 1);
			assert.isTrue(annotations[0].annotationComment.startsWith('external '));
		}
	});

	it('rechecks an unchanged file when storage mode returns to Dual', async function () {
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		Zotero.Prefs.set('reader.annotations.storageMode', 'standard');
		await Zotero.Reader._pollLinkedPDFAnnotations();
		let queue = sandbox.stub(Zotero.Reader, '_queueAnnotationRecovery').resolves({
			conflicts: [],
			pendingRepairs: []
		});
		Zotero.Prefs.set('reader.annotations.storageMode', 'pdf-and-zotero');
		await Zotero.Reader._pollLinkedPDFAnnotations();
		sinon.assert.callCount(queue, attachments.length);
	});

	it('does not requeue an unchanged successfully reconciled file', async function () {
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		let queue = sandbox.spy(Zotero.Reader, '_queueAnnotationRecovery');

		await Zotero.Reader._pollLinkedPDFAnnotations();

		sinon.assert.notCalled(queue);
	});

	it('retries a deferred result for the same file on the next bounded poll', async function () {
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		await writePDFAnnotation(
			attachments[0],
			makeAnnotation(Zotero.DataObjectUtilities.generateKey(), 'deferred file', 680)
		);
		let queue = sandbox.stub(Zotero.Reader, '_queueAnnotationRecovery');
		queue.onFirstCall().resolves(null);
		queue.onSecondCall().resolves({ conflicts: [], pendingRepairs: [] });

		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader._pollLinkedPDFAnnotations();

		sinon.assert.calledTwice(queue);
		assert.equal(
			Zotero.Reader._annotationFilePollState.get(attachments[0].id).status,
			'reconciled'
		);
	});

	it('reconciles a linked PDF after it returns from an unavailable state', async function () {
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery(attachments.map(attachment => attachment.id));
		let attachment = attachments[0];
		let filePath = await attachment.getFilePathAsync();
		await IOUtils.remove(filePath);
		await Zotero.Reader._pollLinkedPDFAnnotations();
		assert.equal(
			Zotero.Reader._annotationFilePollState.get(attachment.id).status,
			'unavailable'
		);

		await IOUtils.copy(PathUtils.join(getTestDataDirectory().path, 'test.pdf'), filePath);
		await writePDFAnnotation(
			attachment,
			makeAnnotation(Zotero.DataObjectUtilities.generateKey(), 'returned file', 620)
		);
		await Zotero.Reader._pollLinkedPDFAnnotations();
		await Zotero.Reader.waitForAnnotationRecovery([attachment.id]);

		assert.equal(
			Zotero.Reader._annotationFilePollState.get(attachment.id).status,
			'reconciled'
		);
		assert.equal(attachment.getAnnotations()[0].annotationComment, 'returned file');
	});

	it('does not overlap poll passes and tears down its timer', async function () {
		let entered = Zotero.Promise.defer();
		let release = Zotero.Promise.defer();
		let calls = 0;
		sandbox.stub(Zotero.Reader, '_pollLinkedPDFAnnotations').callsFake(async () => {
			calls++;
			entered.resolve();
			await release.promise;
			return [];
		});
		Zotero.Reader._startAnnotationFilePolling();
		assert.isOk(Zotero.Reader._annotationFilePollTimer);
		let first = Zotero.Reader._runAnnotationFilePoll();
		await entered.promise;
		let second = Zotero.Reader._runAnnotationFilePoll();
		assert.strictEqual(first, second);
		assert.equal(calls, 1);
		let stopped = Zotero.Reader._stopAnnotationFilePolling();
		assert.isNull(Zotero.Reader._annotationFilePollTimer);
		release.resolve();
		await Promise.all([first, stopped]);
	});
});
