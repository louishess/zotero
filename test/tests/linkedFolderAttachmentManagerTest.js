describe('Zotero.LinkedFolderAttachmentManager', function () {
	let tempDir;
	let sandbox;
	let originalPrefs;
	let createdItems;

	async function makeArticle(title = 'A Cloud-Synchronized Paper') {
		let item = await createDataObject('item', {
			itemType: 'journalArticle',
			title,
		});
		createdItems.push(item);
		return item;
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

	function setPref(name, value) {
		if (value === undefined || value === null || value === false && name == 'baseAttachmentPath') {
			Zotero.Prefs.clear(name);
		}
		else {
			Zotero.Prefs.set(name, value);
		}
	}

	async function enableForExplicitCalls() {
		await Zotero.LinkedFolderAttachmentManager.resume();
		let originalGet = Zotero.Prefs.get.bind(Zotero.Prefs);
		sandbox.stub(Zotero.Prefs, 'get').callsFake((name) => {
			if (name == 'linkedFolderAttachments.enabled') return true;
			return originalGet(name);
		});
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

		assert.isOk(linkedPrimary?.isLinkedFileAttachment());
		assert.isOk(linkedSupplement?.isLinkedFileAttachment());
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
		assert.equal(status.counts['waiting-root'], 1);
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
			assert.equal(status.counts['waiting-reader'], 1);
		}
		finally {
			Zotero.Reader._readers.splice(Zotero.Reader._readers.indexOf(fakeReader), 1);
		}
	});

	it('resumes after a failure between linked verification and source erasure', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let originalErase = source.eraseTx.bind(source);
		let erase = sandbox.stub(source, 'eraseTx');
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
		assert.isOk(linked?.isLinkedFileAttachment());
		assert.isNotOk(Zotero.Items.get(source.id));
		let final = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(final.jobs[0].phase, 'complete');
	});

	it('retains both copies when the stored PDF changes after cloud verification', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let sourcePath = await source.getFilePathAsync();
		let erase = sandbox.stub(source, 'eraseTx').rejects(new Error('simulated interruption'));
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
		assert.match(final.jobs[0].lastError, /source PDF changed/);
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
		await enableForExplicitCalls();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);

		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'conflict');
		assert.equal(status.jobs[0].conflictingOwnerID, 'FOREIGN-CLIENT');
	});

	it('stops before item mutation when paused during copying', async function () {
		let parent = await makeArticle();
		let source = await makePDF(parent);
		let provider = Zotero.LinkedFolderProviders.get('local-folder');
		sandbox.stub(Zotero.LinkedFolderProviders, 'get').callsFake(id => (id == 'local-folder'
			? {
				...provider,
				validateRoot: async (path) => {
					let result = await provider.validateRoot(path);
					await Zotero.LinkedFolderAttachmentManager.pause();
					return result;
				},
			}
			: null));
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
		let plan = await Zotero.LinkedFolderAttachmentManager
			.prepareManagedFileDeletion([linked.id]);
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
			'managed-file-identity-mismatch-at-deletion'
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
});
