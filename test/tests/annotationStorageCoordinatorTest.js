describe('Zotero.AnnotationStorageCoordinator', function () {
	let attachment;
	let sandbox;
	let mode;
	let pdfAnnotations;
	let tombstones;
	let revision;
	let originalGetAnnotationDigest;

	function makeAnnotation(id, comment = '') {
		return {
			id,
			type: 'highlight',
			text: 'Text',
			comment,
			color: '#ffd400',
			pageLabel: '1',
			sortIndex: '00000|000000|00000',
			position: { pageIndex: 0, rects: [[50, 700, 150, 712]] },
			tags: []
		};
	}

	function digest(annotation) {
		return Zotero.Utilities.Internal.sha1(JSON.stringify({
			id: annotation.id,
			type: annotation.type,
			text: annotation.text || '',
			comment: annotation.comment || '',
			color: annotation.color,
			position: annotation.position,
			tags: annotation.tags || []
		}));
	}

	function readResult() {
		let annotations = [...pdfAnnotations.values()].map(annotation => ({
			...JSON.parse(JSON.stringify(annotation)),
			source: { type: 'zotero', id: annotation.id }
		}));
		return {
			annotations,
			digests: Object.fromEntries(annotations.map(x => [x.id, digest(x)])),
			baseDigests: {},
			tombstones: [...tombstones.values()].map(x => ({ ...x })),
			fileToken: { size: 100 + revision, lastModified: 1000 + revision },
			fileRevision: revision
		};
	}

	beforeEach(async function () {
		// Coordinator tests use one in-memory PDF snapshot for every attachment.
		// Keep reader notification recovery in the dedicated reader suite so an
		// item notifier from one fixture cannot mutate another fixture's snapshot.
		await Zotero.Reader.waitForAnnotationRecovery();
		sandbox = sinon.createSandbox();
		sandbox.stub(Zotero.Reader, '_queueAnnotationRecoveryForNotification')
			.callsFake(() => Promise.resolve());
		sandbox.stub(Zotero.Reader, '_queueAnnotationRecoveryForLibraries')
			.callsFake(() => Promise.resolve());
		attachment = await importFileAttachment('test.pdf');
		mode = 'pdf-and-zotero';
		pdfAnnotations = new Map();
		tombstones = new Map();
		revision = 1;

		sandbox.stub(Zotero.PDFWorker, 'getEffectiveAnnotationStorageMode').callsFake(async () => mode);
		sandbox.stub(Zotero.PDFWorker, 'canWriteAnnotationsToFile').resolves(true);
		sandbox.stub(Zotero.PDFWorker, 'readAnnotations').callsFake(async () => readResult());
		sandbox.stub(Zotero.PDFWorker, 'applyAnnotationChanges').callsFake(async (
			_itemID,
			changes
		) => {
			for (let replacement of changes.identityReplacements || []) {
				let oldID = replacement.source.id;
				let annotation = pdfAnnotations.get(oldID);
				if (annotation) {
					pdfAnnotations.delete(oldID);
					pdfAnnotations.set(replacement.id, { ...annotation, id: replacement.id });
				}
			}
			for (let { annotation } of changes.upserts || []) {
				pdfAnnotations.set(annotation.id, JSON.parse(JSON.stringify(annotation)));
			}
			for (let source of [...(changes.deletions || []), ...(changes.duplicateRemovals || [])]) {
				pdfAnnotations.delete(source.id);
			}
			for (let value of changes.tombstones?.upserts || []) {
				tombstones.set(value.id, { ...value });
			}
			for (let id of changes.tombstones?.deletions || []) {
				tombstones.delete(id);
			}
			revision++;
			return readResult();
		});

		originalGetAnnotationDigest = Zotero.PDFWorker.getAnnotationDigest;
		Zotero.PDFWorker.getAnnotationDigest = async annotation => digest(annotation);
	});

	afterEach(async function () {
		try {
			await Zotero.Reader.waitForAnnotationRecovery();
			await Zotero.AnnotationStorageCoordinator.clearLocalState(attachment.id);
		}
		catch (e) {
			// The attachment might already have been erased by a failing test.
		}
		Zotero.PDFWorker.getAnnotationDigest = originalGetAnnotationDigest;
		sandbox.restore();
		if (Zotero.Items.get(attachment.id)) {
			await attachment.eraseTx();
		}
		await Zotero.Reader.waitForAnnotationRecovery();
	});

	it('writes and verifies the PDF before creating the native mirror', async function () {
		let id = 'DUAL2345';
		let apply = Zotero.PDFWorker.applyAnnotationChanges;
		apply.callsFake(async (_itemID, changes) => {
			assert.isNotOk(
				Zotero.Items.getByLibraryAndKey(attachment.libraryID, id),
				'native annotation must not exist during the PDF phase'
			);
			for (let { annotation } of changes.upserts || []) {
				pdfAnnotations.set(annotation.id, JSON.parse(JSON.stringify(annotation)));
			}
			revision++;
			return readResult();
		});

		let result = await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachment.id,
			{ upserts: [makeAnnotation(id, 'created')] }
		);

		assert.equal(result.effectiveMode, 'pdf-and-zotero');
		assert.equal(result.appliedMode, 'pdf-and-zotero');
		assert.equal(pdfAnnotations.get(id).comment, 'created');
		let item = Zotero.Items.getByLibraryAndKey(attachment.libraryID, id);
		assert.isOk(item);
		assert.equal(item.annotationComment, 'created');
	});

	it('reports a conflict when the PDF and Zotero item both changed from the base', async function () {
		let id = 'DUAL2346';
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachment.id,
			{ upserts: [makeAnnotation(id, 'base')] }
		);

		pdfAnnotations.set(id, makeAnnotation(id, 'box edit'));
		let native = Zotero.Items.getByLibraryAndKey(attachment.libraryID, id);
		native.annotationComment = 'zotero sync edit';
		await native.saveTx();

		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'external-file-change'
		);

		assert.lengthOf(result.conflicts, 1);
		assert.equal(result.conflicts[0].id, id);
		assert.equal(result.conflicts[0].pdf.comment, 'box edit');
		assert.equal(result.conflicts[0].zotero.comment, 'zotero sync edit');
	});

	it('accepts ID-keyed conflict resolutions and writes the PDF first', async function () {
		let id = 'DUAL2347';
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachment.id,
			{ upserts: [makeAnnotation(id, 'base')] }
		);
		pdfAnnotations.set(id, makeAnnotation(id, 'box edit'));
		let native = Zotero.Items.getByLibraryAndKey(attachment.libraryID, id);
		native.annotationComment = 'zotero edit';
		await native.saveTx();

		let result = await Zotero.AnnotationStorageCoordinator.resolveConflicts(
			attachment.id,
			{ [id]: 'zotero' }
		);

		assert.deepEqual(result.resolved, [id]);
		assert.equal(pdfAnnotations.get(id).comment, 'zotero edit');
	});

	it('rotates PDF identities before erasing native items on entry to PDF-only', async function () {
		let oldID = 'DUAL2348';
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachment.id,
			{ upserts: [makeAnnotation(oldID, 'rotate me')] }
		);
		mode = 'pdf-only';

		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'mode-change'
		);

		assert.equal(result.appliedMode, 'pdf-only');
		assert.isFalse(pdfAnnotations.has(oldID));
		assert.lengthOf([...pdfAnnotations.keys()], 1);
		let newID = [...pdfAnnotations.keys()][0];
		assert.notEqual(newID, oldID);
		assert.isNotOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, oldID));
		let dateDeleted = await Zotero.Sync.Data.Local.getDateDeleted(
			'item',
			attachment.libraryID,
			oldID
		);
		assert.isOk(dateDeleted, 'the erased generation should enter the normal sync delete log');
	});

	it('returns supported ID-less PDF annotations for PDF-only display', async function () {
		mode = 'pdf-only';
		Zotero.PDFWorker.readAnnotations.callsFake(async () => ({
			annotations: [{
				type: 'highlight',
				comment: 'external',
				color: '#ffd400',
				position: { pageIndex: 0, rects: [[20, 20, 40, 30]] },
				tags: [],
				source: { type: 'fingerprint', pageIndex: 0, fingerprint: 'external' }
			}],
			digests: {},
			baseDigests: {},
			tombstones: [],
			fileToken: { size: 100, lastModified: 1000 },
			fileRevision: 1
		}));

		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'reader-open'
		);

		assert.lengthOf(result.annotations, 1);
		assert.isUndefined(result.annotations[0].id);
		assert.equal(result.annotations[0].comment, 'external');
	});

	it('reports a conflict when a tombstoned annotation was edited natively', async function () {
		let id = 'DUAL2349';
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachment.id,
			{ upserts: [makeAnnotation(id, 'base')] }
		);
		let priorDigest = digest(pdfAnnotations.get(id));
		pdfAnnotations.delete(id);
		tombstones.set(id, {
			id,
			priorDigest,
			deletionRevision: 2,
			time: new Date().toISOString()
		});
		let native = Zotero.Items.getByLibraryAndKey(attachment.libraryID, id);
		native.annotationComment = 'edited after deletion';
		await native.saveTx();

		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'zotero-sync'
		);

		assert.lengthOf(result.conflicts, 1);
		assert.equal(result.conflicts[0].type, 'deletion-vs-edit');
		assert.equal(result.conflicts[0].zotero.comment, 'edited after deletion');
		assert.isOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, id));

		await Zotero.AnnotationStorageCoordinator.resolveConflicts(
			attachment.id,
			{ [id]: 'zotero' }
		);
		assert.isFalse(tombstones.has(id), 'keeping the Zotero edit must clear the tombstone');
	});

	it('removes all duplicate PDF sources when resolving with Zotero', async function () {
		let id = 'DUAL2352';
		let nativeJSON = makeAnnotation(id, 'zotero version');
		delete nativeJSON.id;
		await Zotero.Annotations.saveFromJSON(attachment, {
			...nativeJSON,
			key: id
		});
		let duplicate = true;
		Zotero.PDFWorker.readAnnotations.callsFake(async () => {
			let annotations = duplicate
				? [makeAnnotation(id, 'pdf one'), makeAnnotation(id, 'pdf two')]
				: [makeAnnotation(id, 'zotero version')];
			return {
				annotations: annotations.map((annotation, occurrence) => ({
					...annotation,
					source: { type: 'zotero', id, pageIndex: 0, occurrence }
				})),
				digests: { [id]: digest(annotations[0]) },
				baseDigests: {},
				tombstones: [],
				fileToken: { size: 100 + revision, lastModified: 1000 + revision },
				fileRevision: revision
			};
		});
		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'reader-open'
		);
		assert.equal(result.conflicts[0].type, 'duplicate-pdf-id');

		Zotero.PDFWorker.applyAnnotationChanges.callsFake(async (_itemID, changes) => {
			assert.lengthOf(changes.duplicateRemovals, 2);
			assert.lengthOf(changes.upserts, 1);
			duplicate = false;
			revision++;
			return Zotero.PDFWorker.readAnnotations();
		});
		result = await Zotero.AnnotationStorageCoordinator.resolveConflicts(
			attachment.id,
			{ [id]: 'zotero' }
		);
		assert.deepEqual(result.resolved, [id]);
		assert.equal(result.annotations[0].comment, 'zotero version');
	});

	it('resumes PDF-only to Standard after PDF removal fails', async function () {
		let id = 'DUAL2353';
		mode = 'pdf-only';
		pdfAnnotations.set(id, makeAnnotation(id, 'convert'));
		await Zotero.AnnotationStorageCoordinator.reconcile(attachment.id, 'reader-open');
		mode = 'standard';
		let failed = false;
		Zotero.PDFWorker.applyAnnotationChanges.callsFake(async (_itemID, changes) => {
			if (!failed && changes.deletions?.length) {
				failed = true;
				throw new Error('simulated PDF failure');
			}
			for (let source of changes.deletions || []) pdfAnnotations.delete(source.id);
			revision++;
			return readResult();
		});

		let error = await getPromiseError(
			Zotero.AnnotationStorageCoordinator.reconcile(attachment.id, 'mode-change')
		);
		assert.equal(error.message, 'simulated PDF failure');
		assert.isOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, id));
		assert.isTrue(pdfAnnotations.has(id));

		let result = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachment.id,
			'retry'
		);
		assert.equal(result.appliedMode, 'standard');
		assert.isFalse(pdfAnnotations.has(id));
		assert.isOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, id));
	});

	it('serializes attachment locks and permits a reentrant coordinator call', async function () {
		let started = Zotero.Promise.defer();
		let release = Zotero.Promise.defer();
		let events = [];
		let first = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
			attachment.id,
			async lockToken => {
				events.push('first');
				started.resolve();
				await release.promise;
				await Zotero.AnnotationStorageCoordinator.reconcile(
					attachment.id,
					'lock-reentrant',
					lockToken
				);
				events.push('first-done');
			}
		);
		await started.promise;
		let second = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
			attachment.id,
			async () => events.push('second')
		);
		await Zotero.Promise.delay(20);
		assert.deepEqual(events, ['first']);
		release.resolve();
		await Promise.all([first, second]);
		assert.deepEqual(events, ['first', 'first-done', 'second']);
	});

	it('rejects forged attachment lock tokens', function () {
		assert.throws(
			() => Zotero.AnnotationStorageCoordinator.reconcile(
				attachment.id,
				'forged-token',
				{ keys: new Set([String(attachment.id)]) }
			),
			/Invalid or expired annotation attachment lock token/
		);
	});

	it('extends a source lock without deadlocking an overlapping replacement lock', async function () {
		let started = Zotero.Promise.defer();
		let release = Zotero.Promise.defer();
		let replacement = `${attachment.id}-replacement`;
		let extendedToken;
		let migration = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
			attachment.id,
			async sourceToken => {
				started.resolve();
				await release.promise;
				return Zotero.AnnotationStorageCoordinator.withAttachmentLock(
					[attachment.id, replacement],
					async migrationToken => extendedToken = migrationToken,
					sourceToken
				);
			}
		);
		await started.promise;
		let overlapping = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
				[attachment.id, replacement],
			async () => 'overlapping'
		);
		release.resolve();
		await migration;
		assert.isOk(extendedToken);
		assert.equal(await overlapping, 'overlapping');
	});

	it('holds the attachment reservation through reader open before migration starts', async function () {
		let started = Zotero.Promise.defer();
		let release = Zotero.Promise.defer();
		sandbox.stub(Zotero.Reader, '_openWithAttachmentLock').callsFake(async (
			itemID, _location, _options, lockToken
		) => {
			assert.equal(itemID, attachment.id);
			assert.isOk(lockToken);
			started.resolve();
			await release.promise;
			return 'reader-opened';
		});

		let opening = Zotero.Reader.open(attachment.id, null, {});
		await started.promise;
		let migrationStarted = false;
		let migration = Zotero.AnnotationStorageCoordinator.withAttachmentLock(
			attachment.id,
			async () => {
				migrationStarted = true;
			}
		);
		await Zotero.Promise.delay(20);
		assert.isFalse(migrationStarted);
		release.resolve();
		assert.equal(await opening, 'reader-opened');
		await migration;
		assert.isTrue(migrationStarted);
	});

	it('transfers coordinator recovery state without changing native annotation keys', async function () {
		let replacement = await importFileAttachment('test.pdf');
		let id = 'TRNSFABC';
		try {
			await Zotero.AnnotationStorageCoordinator.applyChanges(
				attachment.id,
				{ upserts: [makeAnnotation(id, 'keep key')] }
			);
			let result = await Zotero.AnnotationStorageCoordinator.withAttachmentLock(
				attachment.id,
				lockToken => Zotero.AnnotationStorageCoordinator.withAttachmentLock(
					[attachment.id, replacement.id],
					migrationToken => Zotero.AnnotationStorageCoordinator.transferState(
						attachment.id,
						replacement.id,
						{ lockToken: migrationToken }
					),
					lockToken
				)
			);
			assert.deepEqual(result.annotationIDs, [id]);
			assert.equal(result.state.lastCommon[id], digest(makeAnnotation(id, 'keep key')));
			let sourceValue = await Zotero.DB.valueQueryAsync(
				'SELECT value FROM settings WHERE setting=? AND key=?',
				['annotationStorageCoordinator', `${attachment.libraryID}/${attachment.key}`]
			);
			let destinationValue = await Zotero.DB.valueQueryAsync(
				'SELECT value FROM settings WHERE setting=? AND key=?',
				['annotationStorageCoordinator', `${replacement.libraryID}/${replacement.key}`]
			);
			assert.isOk(sourceValue, 'source state remains available for verification');
			assert.deepEqual(JSON.parse(destinationValue).lastCommon, JSON.parse(sourceValue).lastCommon);
			assert.isOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, id));
		}
		finally {
			await Zotero.AnnotationStorageCoordinator.clearLocalState(replacement.id);
			if (Zotero.Items.get(replacement.id)) await replacement.eraseTx();
		}
	});

	it('migrates v1 state without dropping pending work or recovery markers', async function () {
		let replacement = await importFileAttachment('test.pdf');
		let state = {
			version: 1,
			mode: 'pdf-and-zotero',
			lastCommon: { LEGACYAB: 'legacy-digest' },
			pending: {
				conversion: {
					from: 'pdf-and-zotero',
					to: 'pdf-only',
					phase: 'prepared',
					rotations: [{ oldID: 'LEGACYAB', newID: 'LEGACYCD' }]
				}
			},
			recovery: { status: 'waiting', operation: 'conversion' }
		};
		try {
			await Zotero.DB.queryAsync(
				'REPLACE INTO settings (setting, key, value) VALUES (?, ?, ?)',
				['annotationStorageCoordinator', `${attachment.libraryID}/${attachment.key}`, JSON.stringify(state)]
			);
			let result = await Zotero.AnnotationStorageCoordinator.transferState(
				attachment.id,
				replacement.id
			);
			assert.equal(result.state.version, 2);
			assert.deepEqual(result.state.lastCommon, state.lastCommon);
			assert.deepEqual(result.state.pending, state.pending);
			assert.deepEqual(result.state.recovery, state.recovery);
		}
		finally {
			await Zotero.AnnotationStorageCoordinator.clearLocalState(replacement.id);
			if (Zotero.Items.get(replacement.id)) await replacement.eraseTx();
		}
	});

	it('fails closed on an unknown persisted state version', async function () {
		let state = {
			version: 99,
			mode: 'pdf-and-zotero',
			lastCommon: { FUTUREAB: 'future-digest' },
			pending: { database: { upsertIDs: ['FUTUREAB'], deletionIDs: [] } },
			recovery: { status: 'waiting', operation: 'future' }
		};
		await Zotero.DB.queryAsync(
			'REPLACE INTO settings (setting, key, value) VALUES (?, ?, ?)',
			['annotationStorageCoordinator', `${attachment.libraryID}/${attachment.key}`, JSON.stringify(state)]
		);
		let error = await getPromiseError(
			Zotero.AnnotationStorageCoordinator.reconcile(attachment.id, 'unknown-state')
		);
		assert.include(error.message, 'Unsupported annotation coordinator state version');
		let persisted = await Zotero.DB.valueQueryAsync(
			'SELECT value FROM settings WHERE setting=? AND key=?',
			['annotationStorageCoordinator', `${attachment.libraryID}/${attachment.key}`]
		);
		assert.deepEqual(JSON.parse(persisted), state);
	});
});

describe('Zotero.AnnotationStorageCoordinator with the real PDF worker', function () {
	let article;
	let attachments;
	let previousStorageMode;
	let hadStorageModeUserValue;

	function makeAnnotation(id, comment, y) {
		return {
			id,
			type: 'note',
			color: '#ffd400',
			comment,
			authorName: 'Coordinator integration test',
			dateModified: '2026-01-02T03:04:05.000Z',
			sortIndex: '00000|000000|00000',
			tags: [],
			pageLabel: '1',
			position: { pageIndex: 0, rects: [[50, y, 72, y + 22]] }
		};
	}

	beforeEach(async function () {
		hadStorageModeUserValue = Zotero.Prefs.prefHasUserValue(
			'reader.annotations.storageMode'
		);
		previousStorageMode = Zotero.Prefs.get('reader.annotations.storageMode');
		Zotero.Prefs.set('reader.annotations.storageMode', 'pdf-and-zotero');
		article = await createDataObject('item', { itemType: 'journalArticle' });
		attachments = await Promise.all([
			importFileAttachment('test.pdf', { parentID: article.id }),
			importFileAttachment('test.pdf', { parentID: article.id })
		]);
	});

	afterEach(async function () {
		await Zotero.Reader.waitForAnnotationRecovery();
		if (attachments) {
			for (let attachment of attachments) {
				try {
					await Zotero.AnnotationStorageCoordinator.clearLocalState(attachment.id);
				}
				catch (e) {}
			}
		}
		if (article && Zotero.Items.get(article.id)) {
			await article.eraseTx();
		}
		if (hadStorageModeUserValue) {
			Zotero.Prefs.set('reader.annotations.storageMode', previousStorageMode);
		}
		else {
			Zotero.Prefs.clear('reader.annotations.storageMode');
		}
	});

	it('keeps same-named attachment annotations isolated across real PDF writes and reconciliation', async function () {
		assert.equal(attachments[0].attachmentFilename, attachments[1].attachmentFilename);
		assert.notEqual(attachments[0].key, attachments[1].key);
		assert.equal(attachments[0].parentID, article.id);
		assert.equal(attachments[1].parentID, article.id);
		let firstPath = await attachments[0].getFilePathAsync();
		let secondPath = await attachments[1].getFilePathAsync();
		assert.notEqual(firstPath, secondPath);

		let first = makeAnnotation('MAIN2345', 'main attachment', 700);
		let second = makeAnnotation('SIPDF234', 'supporting information', 650);
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachments[0].id,
			{ upserts: [first] }
		);
		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachments[1].id,
			{ upserts: [second] }
		);

		let firstPDF = await Zotero.PDFWorker.readAnnotations(attachments[0].id, true);
		let secondPDF = await Zotero.PDFWorker.readAnnotations(attachments[1].id, true);
		assert.deepEqual(firstPDF.annotations.filter(x => x.id).map(x => x.id), ['MAIN2345']);
		assert.deepEqual(secondPDF.annotations.filter(x => x.id).map(x => x.id), ['SIPDF234']);
		assert.equal(attachments[0].getAnnotations().filter(x => !x.annotationIsExternal).length, 1);
		assert.equal(attachments[1].getAnnotations().filter(x => !x.annotationIsExternal).length, 1);
		assert.equal(attachments[0].getAnnotations().find(x => x.key === 'MAIN2345').parentID, attachments[0].id);
		assert.equal(attachments[1].getAnnotations().find(x => x.key === 'SIPDF234').parentID, attachments[1].id);

		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachments[1].id,
			{ upserts: [makeAnnotation('SIPDF234', 'edited supporting information', 650)] }
		);
		firstPDF = await Zotero.PDFWorker.readAnnotations(attachments[0].id, true);
		secondPDF = await Zotero.PDFWorker.readAnnotations(attachments[1].id, true);
		assert.equal(firstPDF.annotations.find(x => x.id === 'MAIN2345').comment, 'main attachment');
		assert.equal(secondPDF.annotations.find(x => x.id === 'SIPDF234').comment, 'edited supporting information');
		assert.equal(attachments[0].getAnnotations().find(x => x.key === 'MAIN2345').annotationComment, 'main attachment');
		assert.equal(attachments[1].getAnnotations().find(x => x.key === 'SIPDF234').annotationComment, 'edited supporting information');

		await Zotero.AnnotationStorageCoordinator.applyChanges(
			attachments[1].id,
			{ deletions: [{ id: 'SIPDF234' }] }
		);
		firstPDF = await Zotero.PDFWorker.readAnnotations(attachments[0].id, true);
		secondPDF = await Zotero.PDFWorker.readAnnotations(attachments[1].id, true);
		assert.isOk(firstPDF.annotations.find(x => x.id === 'MAIN2345'));
		assert.isFalse(secondPDF.annotations.some(x => x.id === 'SIPDF234'));
		assert.isOk(attachments[0].getAnnotations().find(x => x.key === 'MAIN2345'));
		assert.isFalse(attachments[1].getAnnotations().some(x => x.key === 'SIPDF234'));

		await Zotero.AnnotationStorageCoordinator.clearLocalState(attachments[0].id);
		await Zotero.AnnotationStorageCoordinator.clearLocalState(attachments[1].id);

		let firstResult = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachments[0].id,
			'reopen'
		);
		let secondResult = await Zotero.AnnotationStorageCoordinator.reconcile(
			attachments[1].id,
			'reopen'
		);
		assert.lengthOf(firstResult.conflicts, 0);
		assert.lengthOf(secondResult.conflicts, 0);
		assert.equal(firstResult.annotations.find(x => x.id === 'MAIN2345').comment, 'main attachment');
		assert.isFalse(secondResult.annotations.some(x => x.id === 'SIPDF234'));
		assert.equal(
			attachments[0].getAnnotations().find(x => x.key === 'MAIN2345').annotationComment,
			'main attachment'
		);
		assert.isFalse(attachments[1].getAnnotations().some(x => x.key === 'SIPDF234'));
	});

	it('recovers a native deletion for a closed PDF and writes a tombstone', async function () {
		let attachment = attachments[0];
		let id = 'CLSDABCD';
		let previousReaders = Zotero.Reader._readers;
		Zotero.Reader._readers = previousReaders.filter(reader => reader.itemID !== attachment.id);
		try {
			await Zotero.AnnotationStorageCoordinator.applyChanges(attachment.id, {
				upserts: [makeAnnotation(id, 'closed target', 700)]
			});
			await Zotero.Reader.waitForAnnotationRecovery();
			let native = attachment.getAnnotations().find(item => item.key === id);
			assert.isOk(native);
			await native.eraseTx();
			await Zotero.Reader.waitForAnnotationRecovery([attachment.id]);

			let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
			assert.isFalse(pdf.annotations.some(annotation => annotation.id === id));
			assert.isTrue(pdf.tombstones.some(tombstone => tombstone.id === id));
			assert.isFalse(attachment.getAnnotations().some(item => item.key === id));
		}
		finally {
			Zotero.Reader._readers = previousReaders;
		}
	});

	it('reconciles a mixed notification batch for two closed PDFs', async function () {
		let previousReaders = Zotero.Reader._readers;
		Zotero.Reader._readers = previousReaders.filter(reader => (
			!attachments.some(attachment => attachment.id === reader.itemID)
		));
		let entries = [
			{ attachment: attachments[0], id: 'BATCHABC', comment: 'first base', y: 700 },
			{ attachment: attachments[1], id: 'BATCHDEF', comment: 'second base', y: 650 }
		];
		try {
			for (let entry of entries) {
				await Zotero.AnnotationStorageCoordinator.applyChanges(entry.attachment.id, {
					upserts: [makeAnnotation(entry.id, entry.comment, entry.y)]
				});
			}
			await Zotero.Reader.waitForAnnotationRecovery();
			let snapshots = await Promise.all(entries.map(entry => (
				Zotero.PDFWorker.readAnnotations(entry.attachment.id, true)
			)));
			for (let [index, entry] of entries.entries()) {
				let base = snapshots[index];
				let changed = makeAnnotation(entry.id, `${entry.comment} changed`, entry.y);
				await Zotero.PDFWorker.applyAnnotationChanges(
					entry.attachment.id,
					{ upserts: [{
						annotation: changed,
						source: base.sources[entry.id],
						baseDigest: base.digests[entry.id]
					}] },
					{ fileToken: base.fileToken, fileRevision: base.fileRevision },
					true
				);
			}
			Zotero.Reader.notify('modify', 'item', entries.map(entry => entry.attachment.id), {});
			await Zotero.Reader.waitForAnnotationRecovery();

			for (let entry of entries) {
				let pdf = await Zotero.PDFWorker.readAnnotations(entry.attachment.id, true);
				assert.equal(
					pdf.annotations.find(annotation => annotation.id === entry.id).comment,
					`${entry.comment} changed`
				);
				let native = entry.attachment.getAnnotations().find(item => item.key === entry.id);
				assert.equal(native.annotationComment, `${entry.comment} changed`);
				let value = await Zotero.DB.valueQueryAsync(
					'SELECT value FROM settings WHERE setting=? AND key=?',
					['annotationStorageCoordinator', `${entry.attachment.libraryID}/${entry.attachment.key}`]
				);
				assert.equal(JSON.parse(value).lastCommon[entry.id], pdf.digests[entry.id]);
			}
		}
		finally {
			Zotero.Reader._readers = previousReaders;
		}
	});

	for (let from of ['standard', 'pdf-only', 'pdf-and-zotero']) {
		for (let to of ['standard', 'pdf-only', 'pdf-and-zotero']) {
			if (from === to) continue;
			it(`preserves real PDF annotations when converting ${from} to ${to}`, async function () {
				let attachment = attachments[0];
				let originalID = Zotero.DataObjectUtilities.generateKey();
				Zotero.Prefs.set('reader.annotations.storageMode', from);
				await Zotero.AnnotationStorageCoordinator.applyChanges(attachment.id, {
					upserts: [makeAnnotation(originalID, 'mode transition', 640)]
				});
				Zotero.Prefs.set('reader.annotations.storageMode', to);
				let result = await Zotero.AnnotationStorageCoordinator.reconcile(attachment.id, 'mode-change');
				assert.equal(result.effectiveMode, to);
				assert.equal(result.appliedMode, to);
				assert.lengthOf(result.conflicts, 0);
				let pdf = await Zotero.PDFWorker.readAnnotations(attachment.id, true);
				let embedded = pdf.annotations.filter(annotation => annotation.id);
				let native = attachment.getAnnotations().filter(annotation => !annotation.annotationIsExternal);
				assert.lengthOf(embedded, to === 'standard' ? 0 : 1);
				assert.lengthOf(native, to === 'pdf-only' ? 0 : 1);
				for (let annotation of embedded) assert.equal(annotation.comment, 'mode transition');
				for (let annotation of native) assert.equal(annotation.annotationComment, 'mode transition');
				if (to === 'pdf-and-zotero') assert.equal(embedded[0].id, native[0].key);
				if (to === 'pdf-only') {
					assert.notEqual(embedded[0].id, originalID, 'leaving database storage rotates identity');
					assert.isNotOk(Zotero.Items.getByLibraryAndKey(attachment.libraryID, originalID));
				}
			});
		}
	}

});
