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
		sandbox.stub(Zotero.Prefs, 'get').callsFake(name => {
			if (name == 'linkedFolderAttachments.enabled') return true;
			return originalGet(name);
		});
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
				try { await loaded.eraseTx(); }
				catch (e) { Zotero.logError(e); }
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

		let linkedPrimary = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(primary.id);
		let linkedSupplement = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(supplement.id);
		createdItems.push(linkedPrimary, linkedSupplement);

		assert.isOk(linkedPrimary?.isLinkedFileAttachment());
		assert.isOk(linkedSupplement?.isLinkedFileAttachment());
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
