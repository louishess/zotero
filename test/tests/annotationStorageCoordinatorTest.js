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
		sandbox = sinon.createSandbox();
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
});
