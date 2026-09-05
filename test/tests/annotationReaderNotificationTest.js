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
		Zotero.Reader.notify(
			'modify',
			'item',
			attachments.map(attachment => attachment.id),
			{}
		);
		await Zotero.Reader.waitForAnnotationRecovery();

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
