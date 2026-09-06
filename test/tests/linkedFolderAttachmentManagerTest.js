describe('Zotero.LinkedFolderAttachmentManager', function () {
	let tempDir;
	let sandbox;
	let originalPrefs;
	let createdItems;
	let createdCollections;

	async function makeArticle(title = 'A Cloud-Synchronized Paper') {
		let item = await createDataObject('item', {
			itemType: 'journalArticle',
			title,
		});
		createdItems.push(item);
		return item;
	}

	async function makeCollection(name, parent = null) {
		let collection = await createDataObject('collection', { name, parentID: parent?.id });
		createdCollections.push(collection);
		return collection;
	}

	async function putInCollections(parent, collections) {
		parent.setCollections(collections.map(collection => collection.id));
		await parent.saveTx();
	}

	async function makePDF(parent, title = 'Full Text PDF') {
		let attachment = await importFileAttachment('test.pdf', {
			parentID: parent.id,
			title,
			contentType: 'application/pdf',
		});
		createdItems.push(attachment);
		return attachment;
	}

	async function makeRealFileAttachment(parent, filename, contentType, contents) {
		let sourcePath = PathUtils.join(tempDir, filename);
		await IOUtils.writeUTF8(sourcePath, contents);
		let attachment = await Zotero.Attachments.importFromFile({
			file: Zotero.File.pathToFile(sourcePath),
			parentItemID: parent.id,
			title: 'Supporting document',
			contentType,
		});
		createdItems.push(attachment);
		return attachment;
	}

	function setPref(name, value) {
		if (value === undefined || value === null || value === false && name == 'baseAttachmentPath') {
			Zotero.Prefs.clear(name);
		}
		else {
			Zotero.Prefs.set(name, value);
		}
	}

	async function enableForExplicitCalls({ claim = true } = {}) {
		await Zotero.LinkedFolderAttachmentManager.resume();
		let originalGet = Zotero.Prefs.get.bind(Zotero.Prefs);
		sandbox.stub(Zotero.Prefs, 'get').callsFake((name) => {
			if (name == 'linkedFolderAttachments.enabled') return true;
			return originalGet(name);
		});
		if (claim) {
			try {
				await Zotero.LinkedFolderAttachmentManager.claimOrganizer();
			}
			catch (e) {
				// Tests that exercise an unavailable root or foreign claim proceed
				// to assert the durable waiting/conflict state.
			}
		}
	}

	async function assertLinkedConversion(result, label = 'conversion') {
		if (!result || typeof result.isLinkedFileAttachment != 'function') {
			let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
			let job = status.jobs?.find(entry => entry.phase != 'complete') || status.jobs?.[0];
			assert.fail(`${label} failed: phase=${job?.phase || 'none'}; waitReason=${job?.waitReason || 'none'}; lastError=${job?.lastError || 'none'}`);
		}
		assert.isTrue(result.isLinkedFileAttachment(), `${label} did not create a linked attachment`);
		return result;
	}

	async function writeManagerSetting(key, value) {
		await Zotero.DB.queryAsync(
			'REPLACE INTO settings (setting, key, value) VALUES (?, ?, ?)',
			['linkedFolderAttachmentManager', key, JSON.stringify(value)]
		);
	}

	beforeEach(async function () {
		this.timeout(20000);
		tempDir = await getTempDirectory();
		sandbox = sinon.createSandbox();
		createdItems = [];
		createdCollections = [];
		originalPrefs = {
			enabled: Zotero.Prefs.get('linkedFolderAttachments.enabled'),
			provider: Zotero.Prefs.get('linkedFolderAttachments.provider'),
			basePath: Zotero.Prefs.get('baseAttachmentPath'),
			relative: Zotero.Prefs.get('saveRelativeAttachmentPath'),
		};
		Zotero.Prefs.set('linkedFolderAttachments.enabled', false);
		Zotero.Prefs.set('linkedFolderAttachments.provider', 'local-folder');
		Zotero.Prefs.set('baseAttachmentPath', tempDir);
		Zotero.Prefs.set('saveRelativeAttachmentPath', true);
		await Zotero.DB.queryAsync(
			"DELETE FROM settings WHERE setting='linkedFolderAttachmentManager'"
		);
	});

	afterEach(async function () {
		sandbox.restore();
		Zotero.Prefs.set('linkedFolderAttachments.enabled', false);
		await Zotero.LinkedFolderAttachmentManager.pause();
		for (let item of createdItems.reverse()) {
			if (!item) continue;
			let loaded = item.id && Zotero.Items.get(item.id);
			if (loaded) {
				try {
					await loaded.eraseTx();
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		}
		for (let collection of createdCollections.reverse()) {
			if (Zotero.Collections.get(collection.id)) await collection.eraseTx();
		}
		await Zotero.DB.queryAsync(
			"DELETE FROM settings WHERE setting='linkedFolderAttachmentManager'"
		);
		setPref('baseAttachmentPath', originalPrefs.basePath);
		setPref('linkedFolderAttachments.provider', originalPrefs.provider);
		setPref('saveRelativeAttachmentPath', originalPrefs.relative);
		setPref('linkedFolderAttachments.enabled', originalPrefs.enabled);
		await removeDir(tempDir);
	});

	it('sanitizes ACS folder names and filenames deterministically', function () {
		let manager = Zotero.LinkedFolderAttachmentManager;
		assert.equal(
			manager.sanitizeArticleFolderName('[1] Smith, J.: A/B? Study. '),
			'Smith, J.- A-B- Study'
		);
		assert.equal(manager.sanitizeArticleFolderName('2024 advances'), '2024 advances');
		assert.equal(manager.sanitizeArticleFolderName('CON'), '_CON');
		assert.equal(manager.sanitizeFilename('Supporting: information'), 'Supporting- information.pdf');
		assert.isAtMost(Array.from(manager.sanitizeArticleFolderName('x'.repeat(150))).length, 100);
	});

	it('converts primary and SI PDFs into one stable ACS article folder', async function () {
		let parent = await makeArticle();
		let primary = await makePDF(parent, 'Article PDF');
		let supplement = await makePDF(parent, 'Supporting Information');
		let annotation = await createAnnotation('highlight', primary, { comment: 'keep me' });
		createdItems.push(annotation);
		primary.addRelation('owl:sameAs', 'https://example.com/source-pdf');
		await primary.saveTx();
		let primaryHash = await Zotero.LinkedFolderAttachmentManager.sha256File(
			await primary.getFilePathAsync()
		);
		let transfer = sandbox.spy(Zotero.Fulltext, 'transferItemIndex');
		sandbox.stub(Zotero.QuickCopy, 'getContentFromItems').returns({
			text: '1. Smith, J.; Doe, A. A/B Study. Journal 2026.',
			html: '',
		});
		await enableForExplicitCalls();

		let [linkedPrimary, linkedSupplement] = await Promise.all([
			Zotero.LinkedFolderAttachmentManager.convertStoredFileToLinkedFile(primary.id),
			Zotero.LinkedFolderAttachmentManager.convertStoredFileToLinkedFile(supplement.id),
		]);
		createdItems.push(linkedPrimary, linkedSupplement);

		await assertLinkedConversion(linkedPrimary, 'primary conversion');
		await assertLinkedConversion(linkedSupplement, 'supplement conversion');
		assert.notEqual(linkedPrimary.id, linkedSupplement.id);
		assert.notEqual(linkedPrimary.key, linkedSupplement.key);
		assert.notEqual(linkedPrimary.attachmentPath, linkedSupplement.attachmentPath);
		assert.isNotOk(Zotero.Items.get(primary.id));
		assert.isNotOk(Zotero.Items.get(supplement.id));
		assert.equal(annotation.parentItemID, linkedPrimary.id);
		assert.deepEqual(linkedPrimary.getRelations()['owl:sameAs'], ['https://example.com/source-pdf']);
		assert.isTrue(transfer.calledWith(sinon.match({ id: primary.id }), sinon.match({ id: linkedPrimary.id })));
		let primaryPath = await linkedPrimary.getFilePathAsync();
		let supplementPath = await linkedSupplement.getFilePathAsync();
		assert.equal(PathUtils.parent(primaryPath), PathUtils.parent(supplementPath));
		assert.equal(
			PathUtils.filename(PathUtils.parent(primaryPath)),
			'Smith, J.; Doe, A. A-B Study. Journal 2026'
		);
		assert.equal(
			await Zotero.LinkedFolderAttachmentManager.sha256File(primaryPath),
			primaryHash
		);
		assert.match(linkedPrimary.attachmentPath, /^attachments:/);
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.counts.complete, 2);
		assert.equal(status.jobs[0].ownerID, Zotero.Users.getLocalUserKey());
		assert.isString(status.jobs[0].ownerGeneration);
	});

	it('retains the stored attachment while the configured root is unavailable', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		Zotero.Prefs.set('baseAttachmentPath', PathUtils.join(tempDir, 'not-mounted'));
		await enableForExplicitCalls();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.waiting, 1);
		assert.equal(status.jobs[0].waitReason, 'root-unavailable');
	});

	it('requires an explicit organizer claim before conversion', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await enableForExplicitCalls({ claim: false });

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		let organizer = await Zotero.LinkedFolderAttachmentManager.getOrganizerStatus();
		assert.isFalse(organizer.isOrganizer);
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].waitReason, 'organizer-required');
		assert.equal(status.jobs[0].phase, 'queued');
	});

	it('waits when the claimed root generation marker is replaced', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await enableForExplicitCalls();
		await IOUtils.remove(PathUtils.join(tempDir, '.zotero-linked-folder-root.json'));

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'queued');
		assert.equal(status.jobs[0].waitReason, 'organizer-root-mismatch');
	});

	it('migrates existing controlled and unknown formats with automatic downloads disabled', async function () {
		let parent = await makeArticle();
		let formats = [
			{
				filename: 'Supporting: document.DOCX',
				contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			},
			{ filename: 'Notes.md', contentType: 'text/markdown' },
			{
				filename: 'Data.xlsx',
				contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			},
			{ filename: 'Audio.mp3', contentType: 'audio/mpeg' },
			{ filename: 'Video.mp4', contentType: 'video/mp4' },
			{ filename: 'Clip.webm', contentType: 'video/webm' },
			{ filename: 'Archive.zip', contentType: 'application/zip' },
			{ filename: 'Opaque.customext', contentType: 'application/octet-stream' },
		];
		let previousPaths = new Set();
		let previousHashes = new Set();
		let previousSyncEnabled = Zotero.Prefs.get('sync.storage.enabled');
		let previousDownloadMode = Zotero.Prefs.get('sync.storage.downloadMode.personal');
		let downloadPrefs = ['pdf', 'docx', 'md', 'xlsx', 'mp3', 'mp4', 'webm']
			.map(type => [`automaticAttachmentDownloads.${type}`, Zotero.Prefs.get(`automaticAttachmentDownloads.${type}`)]);
		for (let [pref] of downloadPrefs) Zotero.Prefs.set(pref, false);
		Zotero.Prefs.set('sync.storage.enabled', false);
		Zotero.Prefs.set('sync.storage.downloadMode.personal', 'on-demand');
		try {
			let sources = [];
			for (let format of formats) {
				sources.push(await makeRealFileAttachment(
					parent,
					format.filename,
					format.contentType,
					`real bytes for ${format.filename}`
				));
			}
			await enableForExplicitCalls();
			for (let [index, format] of formats.entries()) {
				let source = sources[index];
				let sourcePath = await source.getFilePathAsync();
				let expectedFilename = source.attachmentFilename;
				let sourceHash = await Zotero.LinkedFolderAttachmentManager.sha256File(sourcePath);
				let linked = await Zotero.LinkedFolderAttachmentManager
					.convertStoredFileToLinkedFile(source.id);
				createdItems.push(linked);
				await assertLinkedConversion(linked, `${format.filename} conversion`);
				let linkedPath = await linked.getFilePathAsync();
				assert.notEqual(linkedPath, sourcePath);
				assert.isFalse(previousPaths.has(linkedPath));
				assert.isFalse(previousHashes.has(sourceHash));
				assert.equal(PathUtils.filename(linkedPath), expectedFilename);
				assert.equal(
					await Zotero.LinkedFolderAttachmentManager.sha256File(linkedPath),
					sourceHash
				);
				previousPaths.add(linkedPath);
				previousHashes.add(sourceHash);
				assert.equal(index, previousPaths.size - 1);
			}
		}
		finally {
			for (let [pref, value] of downloadPrefs) Zotero.Prefs.set(pref, value);
			Zotero.Prefs.set('sync.storage.enabled', previousSyncEnabled);
			if (previousDownloadMode === undefined || previousDownloadMode === null) {
				Zotero.Prefs.clear('sync.storage.downloadMode.personal');
			}
			else {
				Zotero.Prefs.set('sync.storage.downloadMode.personal', previousDownloadMode);
			}
		}
	});

	it('records revisions only through a verified managed-file write', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await enableForExplicitCalls();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked, 'managed write conversion');

		let settingKey = `managed/${linked.libraryID}/${linked.key}`;
		let original = JSON.parse(await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[settingKey]
		));
		let path = await linked.getFilePathAsync();
		let result = await Zotero.LinkedFolderAttachmentManager.withManagedFileWrite(
			linked.id,
			async context => {
				assert.isTrue(context.trustedBefore);
				await IOUtils.writeUTF8(context.path, 'verified managed edit');
				let stat = await IOUtils.stat(context.path);
				return {
					verifiedIdentity: {
						size: stat.size,
						sha256: await Zotero.LinkedFolderAttachmentManager.sha256File(context.path),
					},
				};
			}
		);
		assert.isOk(result.verifiedIdentity);
		let revised = JSON.parse(await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[settingKey]
		));
		assert.equal(revised.revision, 1);
		assert.deepEqual(revised.previousIdentity, {
			size: original.size,
			sha256: original.sha256,
		});

		await IOUtils.writeUTF8(path, 'untrusted cloud peer edit');
		let called = false;
		await Zotero.LinkedFolderAttachmentManager.withManagedFileWrite(
			linked.id,
			async () => {
				called = true;
				return 'coordinator-result';
			}
		);
		assert.isTrue(called);
		let retained = JSON.parse(await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[settingKey]
		));
		assert.equal(retained.sha256, revised.sha256);
		let orphan = await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[`orphan/${linked.libraryID}/${linked.key}`]
		);
		assert.isString(orphan);
	});

	it('keeps a missing downloaded imported URL file eligible for manual recovery', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent, 'Downloaded PDF');
		source.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_URL;
		source.attachmentFilename = 'downloaded.pdf';
		source.attachmentContentType = 'application/pdf';
		await source.saveTx();
		let path = await source.getFilePathAsync();
		if (path) await IOUtils.remove(path);

		assert.isTrue(await Zotero.LinkedFolderAttachmentManager.isEligibleAttachment(source));
	});

	it('excludes URL snapshots from the single-file migration scope', async function () {
		let parent = await makeArticle();
		let snapshot = await makePDF(parent, 'Saved page');
		snapshot.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_URL;
		snapshot.attachmentContentType = 'text/html';
		await snapshot.saveTx();

		assert.isFalse(await Zotero.LinkedFolderAttachmentManager.isEligibleAttachment(snapshot));
	});

	it('defers conversion while a reader has the PDF open', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let fakeReader = { itemID: source.id, _isTabClosed: false };
		Zotero.Reader._readers.push(fakeReader);
		await enableForExplicitCalls();
		try {
			let result = await Zotero.LinkedFolderAttachmentManager
				.convertStoredFileToLinkedFile(source.id);
			assert.isFalse(result);
			assert.isOk(Zotero.Items.get(source.id));
			let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
			assert.equal(status.waiting, 1);
			assert.equal(status.jobs[0].waitReason, 'reader-open');
		}
		finally {
			Zotero.Reader._readers.splice(Zotero.Reader._readers.indexOf(fakeReader), 1);
		}
	});

	it('waits for pending annotation recovery before copying the source', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let coordinator = Zotero.AnnotationStorageCoordinator;
		let reconcile = sandbox.stub(coordinator, 'reconcile').resolves({
			pendingRepairs: ['database'],
			conflicts: [],
		});
		let copy = sandbox.spy(IOUtils, 'copy');
		await enableForExplicitCalls();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isTrue(reconcile.calledBefore(copy));
		assert.isFalse(copy.called);
		assert.isOk(Zotero.Items.get(source.id));
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'queued');
		assert.equal(status.jobs[0].waitReason, 'annotation-reconcile');
	});

	it('resumes after a failure between linked verification and source erasure', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let originalErase = source.erase.bind(source);
		let erase = sandbox.stub(source, 'erase');
		erase.onFirstCall().rejects(new Error('simulated interruption'));
		erase.onSecondCall().callsFake(originalErase);
		await enableForExplicitCalls();

		let first = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		assert.isFalse(first);
		assert.isOk(Zotero.Items.get(source.id), 'stored item remains after failed erasure');
		let intermediate = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(intermediate.jobs[0].phase, 'children-transferred');

		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id, 'retry-test');
		createdItems.push(linked);
		await assertLinkedConversion(linked, 'resumed conversion');
		assert.isNotOk(Zotero.Items.get(source.id));
		let final = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(final.jobs[0].phase, 'complete');
	});

	it('requires an explicit retry after resolving provider conflict copies', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let annotation = await createAnnotation('highlight', source, { comment: 'retry me' });
		createdItems.push(annotation);
		let sourcePath = await source.getFilePathAsync();
		let sourceHash = await Zotero.LinkedFolderAttachmentManager.sha256File(sourcePath);
		let ownerPath = PathUtils.join(tempDir, '.zotero-linked-folder-owner.json');
		let rootMarkerPath = PathUtils.join(tempDir, '.zotero-linked-folder-root.json');
		let conflictOwnerPath = PathUtils.join(
			tempDir,
			'.zotero-linked-folder-owner (Cloud Conflict).json'
		);
		let conflictRootPath = PathUtils.join(
			tempDir,
			'.zotero-linked-folder-root (Cloud Conflict).json'
		);
		let injected = false;
		sandbox.stub(Zotero.Fulltext, 'indexItems').callsFake(async () => {
			if (injected) return;
			injected = true;
			await IOUtils.writeJSON(conflictOwnerPath, await IOUtils.readJSON(ownerPath));
			await IOUtils.writeJSON(conflictRootPath, await IOUtils.readJSON(rootMarkerPath));
		});
		await enableForExplicitCalls();

		let first = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		assert.isFalse(first);
		assert.isOk(Zotero.Items.get(source.id));
		let intermediate = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(intermediate.jobs[0].phase, 'conflict');
		assert.equal(intermediate.jobs[0].resumePhase, 'children-transferred');
		let linked = await Zotero.Items.getByLibraryAndKeyAsync(
			source.libraryID,
			intermediate.jobs[0].newAttachmentKey
		);
		createdItems.push(linked);
		assert.equal(annotation.parentItemID, linked.id);
		assert.isTrue(await IOUtils.exists(sourcePath));

		await IOUtils.remove(conflictOwnerPath);
		await IOUtils.remove(conflictRootPath);
		let retryResults = await Zotero.LinkedFolderAttachmentManager.retryFailed();
		assert.lengthOf(retryResults, 1);
		assert.equal(retryResults[0].status, 'fulfilled');
		await assertLinkedConversion(retryResults[0].value, 'conflict retry');
		assert.isNotOk(Zotero.Items.get(source.id));
		assert.equal(annotation.parentItemID, linked.id);
		assert.equal(
			await Zotero.LinkedFolderAttachmentManager.sha256File(await linked.getFilePathAsync()),
			sourceHash
		);
		let final = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(final.jobs[0].phase, 'complete');
		assert.equal(final.jobs[0].resumePhase, null);
	});

	it('retains both copies when the stored PDF changes after cloud verification', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let sourcePath = await source.getFilePathAsync();
		let erase = sandbox.stub(source, 'erase').rejects(new Error('simulated interruption'));
		await enableForExplicitCalls();

		let first = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		assert.isFalse(first);
		let intermediate = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(intermediate.jobs[0].phase, 'children-transferred');
		let linked = await Zotero.Items.getByLibraryAndKeyAsync(
			source.libraryID,
			intermediate.jobs[0].newAttachmentKey
		);
		createdItems.push(linked);

		await IOUtils.writeUTF8(sourcePath, 'changed after verified copy');
		let second = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id, 'changed-source-test');

		assert.isFalse(second);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await IOUtils.exists(await linked.getFilePathAsync()));
		assert.isTrue(erase.calledOnce);
		let final = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(final.jobs[0].phase, 'conflict');
		assert.match(final.jobs[0].lastError, /source file changed/);
	});

	it('does not complete an early-phase job after its source disappears', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let sourcePath = await source.getFilePathAsync();
		let folder = PathUtils.join(tempDir, 'Resume Test');
		let targetPath = PathUtils.join(folder, 'test.pdf');
		await IOUtils.makeDirectory(folder);
		await IOUtils.copy(sourcePath, targetPath);
		let linked = await Zotero.Attachments.linkFromFileWithRelativePath({
			path: 'Resume Test/test.pdf',
			title: 'Planned replacement',
			contentType: 'application/pdf',
			parentItemID: parent.id,
		});
		createdItems.push(linked);
		let stat = await IOUtils.stat(targetPath);
		let sha256 = await Zotero.LinkedFolderAttachmentManager.sha256File(targetPath);
		await writeManagerSetting(`job/${source.libraryID}/${source.key}`, {
			v: 1,
			libraryID: source.libraryID,
			sourceKey: source.key,
			parentKey: parent.key,
			phase: 'linked-item-created',
			newAttachmentKey: linked.key,
			targetRelativePath: linked.attachmentPath,
			sourceSize: stat.size,
			sourceSHA256: sha256,
		});
		await source.eraseTx();
		await enableForExplicitCalls();

		await Zotero.LinkedFolderAttachmentManager.queueLibraryMigration();

		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'conflict');
		assert.match(status.jobs[0].lastError, /source disappeared/);
	});

	it('rejects a foreign persisted migration owner before copying', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await IOUtils.writeJSON(PathUtils.join(tempDir, '.zotero-linked-folder-owner.json'), {
			v: 1,
			ownerID: 'FOREIGN-CLIENT',
			generation: 'foreign-generation',
		});
		await enableForExplicitCalls({ claim: false });

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'queued');
		assert.equal(status.jobs[0].waitReason, 'organizer-required');
		assert.equal(status.jobs[0].conflictingOwnerID, 'FOREIGN-CLIENT');
	});

	it('stops before item mutation when paused during copying', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let originalQuery = Zotero.DB.queryAsync.bind(Zotero.DB);
		let pausedAtCopiedTemp = false;
		sandbox.stub(Zotero.DB, 'queryAsync').callsFake(async (sql, params) => {
			let result = await originalQuery(sql, params);
			let savedValue;
			if (!pausedAtCopiedTemp && Array.isArray(params) && typeof params[2] == 'string') {
				try {
					savedValue = JSON.parse(params[2]);
				}
				catch {
					// Other settings use the same query shape but are not migration jobs.
				}
			}
			if (!pausedAtCopiedTemp && savedValue?.phase == 'copied-temp') {
				pausedAtCopiedTemp = true;
				// Pause only after the durable checkpoint is written. The temporary
				// copy can finish and be verified, but no linked item may be created.
				await Zotero.LinkedFolderAttachmentManager.pause();
			}
			return result;
		});
		// Install the pause point before enrollment so a queued notifier job
		// cannot complete the conversion ahead of the explicit call below.
		await enableForExplicitCalls();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'copy-verified');
		assert.isTrue(status.paused);
		assert.isUndefined(status.jobs[0].linkedItemID);
	});

	it('does not trash a managed file that changes after deletion confirmation', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await enableForExplicitCalls();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked, 'managed deletion conversion');
		let plan = await Zotero.LinkedFolderAttachmentManager
			.prepareManagedFileDeletion([linked.id]);
		assert.isFalse(plan.approved);
		assert.isFalse(plan.destructive);
		let linkedPath = await linked.getFilePathAsync();
		await IOUtils.writeUTF8(linkedPath, 'replacement bytes');
		let provider = Zotero.LinkedFolderProviders.get('local-folder');
		let moveToTrash = sinon.stub().resolves('/moved/test.pdf');
		sandbox.stub(Zotero.LinkedFolderProviders, 'get').callsFake(id => (id == 'local-folder'
			? { ...provider, moveToTrash }
			: null));

		let result = await Zotero.LinkedFolderAttachmentManager
			.completeManagedFileDeletion(plan);

		assert.deepEqual(result, { moved: 0, orphaned: 1 });
		assert.isFalse(moveToTrash.called);
		assert.isTrue(await IOUtils.exists(linkedPath));
		let orphan = await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[`orphan/${linked.libraryID}/${linked.key}`]
		);
		assert.isString(orphan);
	});

	it('does not approve an unrelated file after the base directory changes', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		await enableForExplicitCalls();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked, 'root-change conversion');
		let alternateRoot = PathUtils.join(tempDir, 'alternate-root');
		let relativePath = linked.attachmentPath.slice(
			Zotero.Attachments.BASE_PATH_PLACEHOLDER.length
		);
		let unrelatedPath = PathUtils.joinRelative(
			alternateRoot,
			Zotero.Attachments.fixPathSlashes(relativePath)
		);
		await IOUtils.makeDirectory(PathUtils.parent(unrelatedPath), { createAncestors: true });
		await IOUtils.writeUTF8(unrelatedPath, 'unrelated replacement file');
		Zotero.Prefs.set('baseAttachmentPath', alternateRoot);

		let plan = await Zotero.LinkedFolderAttachmentManager
			.prepareManagedFileDeletion([linked.id]);

		assert.isTrue(plan.approved);
		assert.lengthOf(plan.entries, 0);
		assert.isTrue(await IOUtils.exists(unrelatedPath));
		let orphanJSON = await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[`orphan/${linked.libraryID}/${linked.key}`]
		);
		assert.equal(
			JSON.parse(orphanJSON).reason,
			'managed-file-unavailable-at-deletion'
		);
	});

	it('does not adopt an unknown same-named article directory', async function () {
		let parent = await makeArticle();
		sandbox.stub(Zotero.QuickCopy, 'getContentFromItems').returns({
			text: 'Known Citation.',
			html: '',
		});
		await IOUtils.makeDirectory(PathUtils.join(tempDir, 'Known Citation'));

		let folder = await Zotero.LinkedFolderAttachmentManager
			.getOrCreateArticleFolder(parent.id);

		assert.equal(PathUtils.filename(folder), 'Known Citation (2)');
	});
	it('preserves numeric collection prefixes and mirrors nested desktop collections', async function () {
		let parent = await makeArticle();
		let top = await makeCollection('1. Chemistry');
		let child = await makeCollection('[2] Catalysis/2026', top);
		await putInCollections(parent, [top, child]);
		sandbox.stub(Zotero.QuickCopy, 'getContentFromItems').returns({ text: '[1] Stable Citation.' });
		let folder = await Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id);
		assert.equal(folder, PathUtils.join(tempDir, '1. Chemistry', '[2] Catalysis-2026', 'Stable Citation'));
		assert.equal(await Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id), folder);
	});

	it('uses one deterministic deepest collection for articles with multiple memberships', async function () {
		let parent = await makeArticle();
		let top = await makeCollection('Chemistry');
		let first = await makeCollection('First', top);
		let second = await makeCollection('Second', top);
		await putInCollections(parent, [second, top, first]);
		let expected = first.key < second.key ? first : second;
		let folder = await Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id);
		assert.equal(PathUtils.filename(PathUtils.parent(folder)), expected.name);
	});

	it('isolates collections whose names collide after case, Unicode, or filename sanitization', async function () {
		let a = await makeArticle('First');
		let b = await makeArticle('Second');
		let first = await makeCollection('Café/A');
		let second = await makeCollection('CAFE\u0301:A');
		await putInCollections(a, [first]);
		await putInCollections(b, [second]);
		let [aFolder, bFolder] = await Promise.all([
			Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(a.id),
			Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(b.id),
		]);
		assert.equal(PathUtils.filename(PathUtils.parent(aFolder)), 'Café-A');
		assert.equal(PathUtils.filename(PathUtils.parent(bFolder)), 'CAFÉ-A (2)');
	});

	it('shares collection folders while isolating identical article citations during concurrent creation', async function () {
		let collection = await makeCollection('Research');
		let a = await makeArticle();
		let b = await makeArticle();
		await putInCollections(a, [collection]);
		await putInCollections(b, [collection]);
		sandbox.stub(Zotero.QuickCopy, 'getContentFromItems').returns({ text: 'Same Citation' });
		let folders = await Promise.all([a, b].map(parent =>
			Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id)));
		assert.equal(PathUtils.parent(folders[0]), PathUtils.parent(folders[1]));
		assert.notEqual(folders[0], folders[1]);
	});

	it('upgrades existing linked PDFs and SI with stable item and annotation identities', async function () {
		this.timeout(20000);
		let parent = await makeArticle();
		let primary = await makePDF(parent);
		let supplement = await makeRealFileAttachment(parent, 'data.csv', 'text/csv', 'x,y\n1,2');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(primary.id);
		let linkedSI = await manager.convertStoredFileToLinkedFile(supplement.id);
		createdItems.push(linked, linkedSI);
		await assertLinkedConversion(linked);
		await assertLinkedConversion(linkedSI);
		let annotation = await createAnnotation('highlight', linked, { comment: 'Preserved through folder moves' });
		createdItems.push(annotation);
		let originalPath = await linked.getFilePathAsync();
		let citation = PathUtils.filename(PathUtils.parent(originalPath));
		let collection = await makeCollection('2. Project');
		await putInCollections(parent, [collection]);
		await manager.reconcileCollectionHierarchy();
		let expectedFolder = PathUtils.join(tempDir, collection.name, citation);
		assert.equal(PathUtils.parent(await linked.getFilePathAsync()), expectedFolder);
		assert.equal(PathUtils.parent(await linkedSI.getFilePathAsync()), expectedFolder);
		assert.equal(annotation.parentItemID, linked.id);
		assert.isFalse(await IOUtils.exists(originalPath));
		assert.isTrue(await linked.fileExists());
		let status = await manager.getMigrationStatus();
		assert.equal(status.hierarchyJobs[0].phase, 'complete');
		assert.equal(status.jobs.find(job => job.newAttachmentKey == linked.key).targetRelativePath, linked.attachmentPath);
		let record = JSON.parse(await Zotero.DB.valueQueryAsync(
			"SELECT value FROM settings WHERE setting='linkedFolderAttachmentManager' AND key=?",
			[`managed/${linked.libraryID}/${linked.key}`]));
		assert.equal(record.relativePath, linked.attachmentPath);
	});

	it('follows collection renames and moves while keeping the citation folder stable', async function () {
		let parent = await makeArticle();
		let first = await makeCollection('Original');
		await putInCollections(parent, [first]);
		let source = await makeRealFileAttachment(parent, 'results.csv', 'text/csv', 'unchanged');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let citation = PathUtils.filename(PathUtils.parent(await linked.getFilePathAsync()));
		let top = await makeCollection('New Parent');
		let notifiedReconciliation = sandbox.spy(manager, 'reconcileCollectionHierarchy');
		first.name = 'Renamed';
		first.parentID = top.id;
		await first.saveTx();
		assert.isTrue(notifiedReconciliation.called, 'Collection modification did not enqueue hierarchy reconciliation');
		await Promise.all(notifiedReconciliation.returnValues);
		assert.equal(PathUtils.parent(await linked.getFilePathAsync()), PathUtils.join(tempDir, top.name, first.name, citation));
		let stable = linked.attachmentPath;
		await manager.reconcileCollectionHierarchy();
		assert.equal(linked.attachmentPath, stable);
		notifiedReconciliation.resetHistory();
		await putInCollections(parent, []);
		assert.isTrue(notifiedReconciliation.called, 'Collection membership removal did not enqueue hierarchy reconciliation');
		await Promise.all(notifiedReconciliation.returnValues);
		assert.equal(PathUtils.parent(await linked.getFilePathAsync()), PathUtils.join(tempDir, citation));
	});

	it('recovers a copied collection relocation after a failure before the path transaction', async function () {
		let parent = await makeArticle();
		let source = await makeRealFileAttachment(parent, 'recovery.csv', 'text/csv', 'durable original');
		let collection = await makeCollection('Recovery');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let originalPath = await linked.getFilePathAsync();
		let originalQuery = Zotero.DB.queryAsync.bind(Zotero.DB);
		let failure = sandbox.stub(Zotero.DB, 'queryAsync').callsFake(async (sql, params, ...rest) => {
			if (params?.[1]?.startsWith?.('relocation/') && params[2]
					&& JSON.parse(params[2]).phase == 'committed') {
				throw new Error('Simulated pre-commit interruption');
			}
			return originalQuery(sql, params, ...rest);
		});
		await putInCollections(parent, [collection]);
		await manager.reconcileCollectionHierarchy();
		assert.equal(await Zotero.DB.valueQueryAsync(
			'SELECT path FROM itemAttachments WHERE itemID=?', [linked.id]), linked.attachmentPath);
		assert.equal(await linked.getFilePathAsync(), originalPath);
		assert.isTrue(await IOUtils.exists(originalPath));
		assert.equal((await manager.getMigrationStatus()).hierarchyJobs[0].phase, 'planned');
		failure.restore();
		await manager.reconcileCollectionHierarchy();
		assert.notEqual(await linked.getFilePathAsync(), originalPath);
		assert.equal(await IOUtils.readUTF8(await linked.getFilePathAsync()), 'durable original');
		assert.isFalse(await IOUtils.exists(originalPath));
	});

	it('recovers source cleanup after a committed collection path transaction', async function () {
		let parent = await makeArticle();
		let source = await makeRealFileAttachment(parent, 'cleanup.csv', 'text/csv', 'durable original');
		let collection = await makeCollection('Cleanup');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let originalPath = await linked.getFilePathAsync();
		let originalQuery = Zotero.DB.columnQueryAsync.bind(Zotero.DB);
		let failure = sandbox.stub(Zotero.DB, 'columnQueryAsync').callsFake(async (sql, params, ...rest) => {
			if (sql.includes('WHERE path IN') && params?.[0] == originalPath) {
				throw new Error('Simulated cleanup interruption');
			}
			return originalQuery(sql, params, ...rest);
		});
		await putInCollections(parent, [collection]);
		await manager.reconcileCollectionHierarchy();
		assert.notEqual(await linked.getFilePathAsync(), originalPath);
		assert.isTrue(await IOUtils.exists(originalPath));
		assert.equal((await manager.getMigrationStatus()).hierarchyJobs[0].phase, 'committed');
		failure.restore();
		await manager.reconcileCollectionHierarchy();
		assert.isFalse(await IOUtils.exists(originalPath));
		assert.equal((await manager.getMigrationStatus()).hierarchyJobs[0].phase, 'complete');
	});

	it('waits for an open reader before changing collection paths', async function () {
		let parent = await makeArticle();
		let source = await makeRealFileAttachment(parent, 'reader.csv', 'text/csv', 'preserved');
		let collection = await makeCollection('Reader');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let originalPath = await linked.getFilePathAsync();
		let reader = { itemID: linked.id, _isTabClosed: false };
		Zotero.Reader._readers.push(reader);
		try {
			await putInCollections(parent, [collection]);
			await manager.reconcileCollectionHierarchy();
			assert.equal(await linked.getFilePathAsync(), originalPath);
			assert.include((await manager.getMigrationStatus()).hierarchyJobs[0].lastError, 'reader');
			await Zotero.AnnotationStorageCoordinator.withAttachmentLock(linked.id, () =>
				manager.withManagedFileWrite(linked.id, async context => {
					await IOUtils.writeUTF8(context.path, 'verified edit while relocation waits');
					return { verifiedIdentity: {
						size: (await IOUtils.stat(context.path)).size,
						sha256: await manager.sha256File(context.path),
					} };
				}));
		}
		finally {
			Zotero.Reader._readers.splice(Zotero.Reader._readers.indexOf(reader), 1);
		}
		let queued = sandbox.spy(manager, 'queueAttachment');
		await Zotero.Notifier.trigger('close', 'file', [linked.id], {}, true);
		assert.isTrue(queued.calledWith(linked.id, 'notifier-file-close'), 'Reader close did not enqueue recovery');
		await Promise.all(queued.returnValues);
		assert.notEqual(await linked.getFilePathAsync(), originalPath);
		assert.equal(await IOUtils.readUTF8(await linked.getFilePathAsync()), 'verified edit while relocation waits');
	});

	it('retains both files when a copied collection destination is externally replaced', async function () {
		let parent = await makeArticle();
		let source = await makeRealFileAttachment(parent, 'conflict.csv', 'text/csv', 'preserved source');
		let collection = await makeCollection('Conflict');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let originalPath = await linked.getFilePathAsync();
		let originalTransaction = Zotero.DB.executeTransaction.bind(Zotero.DB);
		let changedPath;
		sandbox.stub(Zotero.DB, 'executeTransaction').callsFake(async (operation, ...rest) => {
			let status = await manager.getMigrationStatus();
			let entry = status.hierarchyJobs[0]?.entries[0];
			if (entry?.copyPhase == 'copied' && !changedPath) {
				changedPath = entry.targetPath;
				await IOUtils.writeUTF8(changedPath, 'external replacement');
			}
			return originalTransaction(operation, ...rest);
		});
		await putInCollections(parent, [collection]);
		await manager.reconcileCollectionHierarchy();
		assert.equal(await linked.getFilePathAsync(), originalPath);
		assert.equal(await IOUtils.readUTF8(originalPath), 'preserved source');
		assert.equal(await IOUtils.readUTF8(changedPath), 'external replacement');
		assert.equal((await manager.getMigrationStatus()).hierarchyJobs[0].phase, 'planned');
	});

	it('converges a case-only collection rename to its desktop name after the old folder is empty', async function () {
		let parent = await makeArticle();
		let collection = await makeCollection('Chemistry');
		await putInCollections(parent, [collection]);
		let source = await makeRealFileAttachment(parent, 'case.csv', 'text/csv', 'preserved');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let citation = PathUtils.filename(PathUtils.parent(await linked.getFilePathAsync()));
		collection.name = 'chemistry';
		await collection.saveTx();
		await manager.reconcileCollectionHierarchy();
		await manager.reconcileCollectionHierarchy();
		assert.equal(PathUtils.parent(await linked.getFilePathAsync()), PathUtils.join(tempDir, 'chemistry', citation));
		let stable = linked.attachmentPath;
		await manager.reconcileCollectionHierarchy();
		assert.equal(linked.attachmentPath, stable);
	});

	it('retains a stable collection suffix while the original name belongs to an unmanaged folder', async function () {
		await IOUtils.makeDirectory(PathUtils.join(tempDir, 'Research'));
		let parent = await makeArticle();
		let collection = await makeCollection('Research');
		await putInCollections(parent, [collection]);
		let source = await makeRealFileAttachment(parent, 'collision.csv', 'text/csv', 'preserved');
		await enableForExplicitCalls();
		let manager = Zotero.LinkedFolderAttachmentManager;
		let linked = await manager.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		await assertLinkedConversion(linked);
		let original = linked.attachmentPath;
		await manager.reconcileCollectionHierarchy();
		await manager.reconcileCollectionHierarchy();
		assert.equal(linked.attachmentPath, original);
		assert.equal(PathUtils.filename(PathUtils.parent(PathUtils.parent(await linked.getFilePathAsync()))), 'Research (2)');
	});

});
