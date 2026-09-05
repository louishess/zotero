describe('Linked-folder migration safety', function () {
	let tempDir;
	let sandbox;
	let originalPrefs;
	let createdItems;
	const SETTING = 'linkedFolderAttachmentManager';
	const OWNER_FILENAME = '.zotero-linked-folder-owner.json';
	const ROOT_MARKER_FILENAME = '.zotero-linked-folder-root.json';

	async function makeArticle(title = 'Migration Safety Article') {
		let item = await createDataObject('item', {
			itemType: 'journalArticle',
			title,
		});
		createdItems.push(item);
		return item;
	}

	async function makeAttachment(parent, filename = 'test.txt', options = {}) {
		let attachment = await importFileAttachment(filename, {
			parentID: parent.id,
			title: options.title || filename.replace(/\.[^.]+$/u, ''),
			contentType: options.contentType || 'text/plain',
			...options,
		});
		createdItems.push(attachment);
		return attachment;
	}

	function setPref(name, value) {
		if (value === undefined || value === null
				|| (value === false && name === 'baseAttachmentPath')) {
			Zotero.Prefs.clear(name);
		}
		else {
			Zotero.Prefs.set(name, value);
		}
	}

	async function readSetting(key) {
		let value = await Zotero.DB.valueQueryAsync(
			'SELECT value FROM settings WHERE setting=? AND key=?',
			[SETTING, key]
		);
		return value ? JSON.parse(value) : null;
	}

	async function activateOrganizer() {
		await Zotero.LinkedFolderAttachmentManager.resume();
		let originalGet = Zotero.Prefs.get.bind(Zotero.Prefs);
		sandbox.stub(Zotero.Prefs, 'get').callsFake(name => (
			name === 'linkedFolderAttachments.enabled' ? true : originalGet(name)
		));
		await Zotero.LinkedFolderAttachmentManager.claimOrganizer();
	}

	async function restartManager() {
		await Zotero.LinkedFolderAttachmentManager.pause();
		Zotero.LinkedFolderAttachmentManager.uninit();
		await Zotero.LinkedFolderAttachmentManager.init();
		await Zotero.LinkedFolderAttachmentManager.resume();
	}

	beforeEach(async function () {
		this.timeout(30000);
		tempDir = await getTempDirectory();
		sandbox = sinon.createSandbox();
		createdItems = [];
		originalPrefs = {
			enabled: Zotero.Prefs.get('linkedFolderAttachments.enabled'),
			provider: Zotero.Prefs.get('linkedFolderAttachments.provider'),
			basePath: Zotero.Prefs.get('baseAttachmentPath'),
			relative: Zotero.Prefs.get('saveRelativeAttachmentPath'),
			storageMode: Zotero.Prefs.get('reader.annotations.storageMode'),
			storageModeUserValue: Zotero.Prefs.prefHasUserValue('reader.annotations.storageMode'),
		};
		Zotero.Prefs.set('linkedFolderAttachments.enabled', false);
		Zotero.Prefs.set('linkedFolderAttachments.provider', 'local-folder');
		Zotero.Prefs.set('baseAttachmentPath', tempDir);
		Zotero.Prefs.set('saveRelativeAttachmentPath', true);
		await Zotero.DB.queryAsync(
			"DELETE FROM settings WHERE setting='linkedFolderAttachmentManager'"
		);
		await Zotero.LinkedFolderAttachmentManager.pause();
	});

	afterEach(async function () {
		await Zotero.LinkedFolderAttachmentManager.pause();
		sandbox.restore();
		for (let item of createdItems.reverse()) {
			let loaded = item?.id && Zotero.Items.get(item.id);
			if (!loaded) continue;
			try {
				await loaded.eraseTx();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		await Zotero.DB.queryAsync(
			"DELETE FROM settings WHERE setting='linkedFolderAttachmentManager'"
		);
		setPref('baseAttachmentPath', originalPrefs.basePath);
		setPref('linkedFolderAttachments.provider', originalPrefs.provider);
		setPref('saveRelativeAttachmentPath', originalPrefs.relative);
		setPref('linkedFolderAttachments.enabled', originalPrefs.enabled);
		if (originalPrefs.storageModeUserValue) {
			Zotero.Prefs.set('reader.annotations.storageMode', originalPrefs.storageMode);
		}
		else {
			Zotero.Prefs.clear('reader.annotations.storageMode');
		}
		await removeDir(tempDir);
	});

	it('preserves durable progress across a manager restart', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let originalErase = source.erase.bind(source);
		let erase = sandbox.stub(source, 'erase');
		erase.onFirstCall().rejects(new Error('simulated restart during source erase'));
		erase.onSecondCall().callsFake(originalErase);
		await activateOrganizer();

		assert.isFalse(await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id));
		let interrupted = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(interrupted.jobs[0].phase, 'children-transferred');
		assert.isOk(Zotero.Items.get(source.id));

		await restartManager();
		let resumed = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		let linked = await Zotero.Items.getByLibraryAndKeyAsync(
			resumed.libraryID,
			resumed.jobs[0].newAttachmentKey
		);
		createdItems.push(linked);
		assert.isOk(linked?.isLinkedFileAttachment());
		assert.isNotOk(Zotero.Items.get(source.id));
		assert.equal((await Zotero.LinkedFolderAttachmentManager.getMigrationStatus()).jobs[0].phase, 'complete');
		assert.isTrue(erase.calledTwice);
	});

	it('keeps the replacement and moved children when source erasure removes bytes before failing', async function () {
		Zotero.Prefs.set('reader.annotations.storageMode', 'pdf-and-zotero');
		let parent = await makeArticle();
		let source = await makeAttachment(parent, 'test.pdf', {
			title: 'Migration safety PDF',
			contentType: 'application/pdf',
		});
		let child = await Zotero.Annotations.saveFromJSON(source, {
			key: Zotero.DataObjectUtilities.generateKey(),
			type: 'note',
			isExternal: false,
			readOnly: false,
			comment: 'Child must survive an interrupted source erase',
			color: '#ffd400',
			pageLabel: '1',
			sortIndex: '00000|003305|00000',
			position: { pageIndex: 0, rects: [[50, 700, 72, 722]] },
			tags: [],
		});
		createdItems.push(child);
		let sourcePath = await source.getFilePathAsync();
		let originalErase = source.erase.bind(source);
		let erase = sandbox.stub(source, 'erase');
		erase.onFirstCall().callsFake(async () => {
			await IOUtils.remove(sourcePath);
			throw new Error('source bytes removed before transaction commit');
		});
		erase.onSecondCall().callsFake(originalErase);
		await activateOrganizer();

		assert.isFalse(await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id));
		let interrupted = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		let linked = await Zotero.Items.getByLibraryAndKeyAsync(
			interrupted.libraryID,
			interrupted.jobs[0].newAttachmentKey
		);
		createdItems.push(linked);
		let targetPath = await linked.getFilePathAsync();
		assert.isOk(linked?.isLinkedFileAttachment());
		assert.isTrue(await IOUtils.exists(targetPath));
		assert.equal(child.parentItemID, linked.id);
		assert.isFalse(await IOUtils.exists(sourcePath));
		assert.equal(interrupted.jobs[0].phase, 'children-transferred');

		// The source bytes remain unavailable across restart. A verified target and
		// durable phase must be sufficient for safe source cleanup.
		await restartManager();
		let completed = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(completed.jobs[0].phase, 'complete');
		assert.isNotOk(Zotero.Items.get(source.id));
		assert.isOk(Zotero.Items.get(linked.id));
		assert.equal(child.parentItemID, linked.id);
		assert.isTrue(erase.calledTwice);
	});

	it('waits when a source disappears before migration has selected a target', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let sourcePath = await source.getFilePathAsync();
		await IOUtils.remove(sourcePath);
		await activateOrganizer();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id, 'library-scan');
		assert.isFalse(result);
		assert.isOk(Zotero.Items.get(source.id));
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'queued');
		assert.equal(status.jobs[0].waitReason, 'source-unavailable');
		assert.isFalse(await IOUtils.exists(sourcePath));
		assert.isUndefined(status.jobs[0].targetPath);
	});

	it('stops before source erasure when the organizer claim changes', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let ownerPath = PathUtils.join(tempDir, OWNER_FILENAME);
		let erase = sandbox.spy(source, 'erase');
		sandbox.stub(Zotero.Fulltext, 'transferItemIndex').callsFake(async () => {
			let claim = await IOUtils.readJSON(ownerPath);
			claim.ownerID = 'FOREIGN-OWNER';
			claim.instanceID = 'FOREIGN-INSTANCE';
			claim.generation = 'FOREIGN-GENERATION';
			await IOUtils.writeJSON(ownerPath, claim);
		});
		sandbox.stub(Zotero.Fulltext, 'indexItems').resolves();
		await activateOrganizer();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		assert.isFalse(result);
		assert.isFalse(erase.called);
		assert.isOk(Zotero.Items.get(source.id));
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		let linked = await Zotero.Items.getByLibraryAndKeyAsync(
			status.libraryID,
			status.jobs[0].newAttachmentKey
		);
		if (linked) createdItems.push(linked);
		assert.equal(status.jobs[0].phase, 'children-transferred');
		assert.equal(status.jobs[0].waitReason, 'organizer-required');
		assert.equal((await IOUtils.readJSON(ownerPath)).ownerID, 'FOREIGN-OWNER');
	});

	it('stops before source erasure when the provider creates claim conflict copies', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let ownerPath = PathUtils.join(tempDir, OWNER_FILENAME);
		let rootMarkerPath = PathUtils.join(tempDir, ROOT_MARKER_FILENAME);
		let erase = sandbox.spy(source, 'erase');
		sandbox.stub(Zotero.Fulltext, 'indexItems').callsFake(async () => {
			// File Provider conflict resolution can rename both hidden JSON files
			// while leaving this installation's canonical claim in place.
			let claim = await IOUtils.readJSON(ownerPath);
			let marker = await IOUtils.readJSON(rootMarkerPath);
			await IOUtils.writeJSON(
				PathUtils.join(tempDir, '.zotero-linked-folder-owner (Cloud Conflict).json'),
				claim
			);
			await IOUtils.writeJSON(
				PathUtils.join(tempDir, '.zotero-linked-folder-root (Cloud Conflict).json'),
				marker
			);
		});
		await activateOrganizer();

		let result = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		assert.isFalse(result);
		assert.isFalse(erase.called, 'a conflict copy must block source erasure');
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
		let status = await Zotero.LinkedFolderAttachmentManager.getMigrationStatus();
		assert.equal(status.jobs[0].phase, 'conflict');
		assert.match(status.jobs[0].lastError || '', /claim|owner|root|conflict/i);
	});

	it('does not treat this installation temporary claim files as cloud conflicts', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let erase = sandbox.spy(source, 'erase');
		await activateOrganizer();

		let ownerPath = PathUtils.join(tempDir, OWNER_FILENAME);
		let rootMarkerPath = PathUtils.join(tempDir, ROOT_MARKER_FILENAME);
		let claim = await IOUtils.readJSON(ownerPath);
		let marker = await IOUtils.readJSON(rootMarkerPath);
		await IOUtils.writeJSON(`${ownerPath}.tmp-${claim.instanceID}`, claim);
		await IOUtils.writeJSON(`${rootMarkerPath}.tmp-${marker.generation}`, marker);

		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		assert.isOk(linked?.isLinkedFileAttachment());
		assert.isTrue(erase.calledOnce);
		assert.isNotOk(Zotero.Items.get(source.id));
	});

	it('rejects a switched linked-folder root without adopting its files', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		await activateOrganizer();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		assert.isOk(linked?.isLinkedFileAttachment());

		await Zotero.LinkedFolderAttachmentManager.pause();
		let alternateRoot = PathUtils.join(tempDir, 'alternate-root');
		await IOUtils.makeDirectory(alternateRoot);
		Zotero.Prefs.set('baseAttachmentPath', alternateRoot);
		let error;
		try {
			await Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id);
		}
		catch (e) {
			error = e;
		}
		assert.match(error?.message || '', /mapped to a different linked-folder root/);
		assert.isOk(Zotero.Items.get(linked.id));
		assert.isNotOk(Zotero.Items.get(source.id));
	});

	it('rejects a symlink root before touching a stored source', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		let realRoot = PathUtils.join(tempDir, 'real-root');
		let symlinkRoot = PathUtils.join(tempDir, 'symlink-root');
		await IOUtils.makeDirectory(realRoot);
		assert.isTrue(Zotero.File.createSymlink(realRoot, symlinkRoot));
		Zotero.Prefs.set('baseAttachmentPath', symlinkRoot);

		let error;
		try {
			await Zotero.LinkedFolderAttachmentManager.getOrCreateArticleFolder(parent.id);
		}
		catch (e) {
			error = e;
		}
		assert.match(error?.message || '', /symlink-root/);
		assert.isOk(Zotero.Items.get(source.id));
		assert.isTrue(await source.fileExists());
	});

	it('retains a managed file and records it for noninteractive orphan review', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		await activateOrganizer();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		let linkedPath = await linked.getFilePathAsync();

		let plan = await Zotero.LinkedFolderAttachmentManager
			.prepareManagedFileDeletion([linked.id]);
		assert.isFalse(plan.approved);
		assert.isFalse(plan.destructive);
		assert.isTrue(plan.reviewRequired);
		let result = await Zotero.LinkedFolderAttachmentManager
			.completeManagedFileDeletion(plan);
		assert.deepEqual(result, { moved: 0, orphaned: 1 });
		assert.isTrue(await IOUtils.exists(linkedPath));

		let orphans = await Zotero.LinkedFolderAttachmentManager.getOrphans(parent.libraryID);
		assert.lengthOf(orphans, 1);
		assert.equal(orphans[0].reason, 'noninteractive-item-deletion');
		let review = await Zotero.LinkedFolderAttachmentManager
			.reviewOrphan(parent.libraryID, linked.key, 'retain');
		assert.equal(review.state, 'retained');
		assert.isTrue(await IOUtils.exists(linkedPath));
	});

	it('records verified annotation revisions but orphans unrelated replacements', async function () {
		Zotero.Prefs.set('reader.annotations.storageMode', 'pdf-and-zotero');
		assert.isFunction(Zotero.LinkedFolderAttachmentManager.withManagedFileWrite);
		let parent = await makeArticle();
		let source = await makeAttachment(parent, 'test.pdf', {
			title: 'Article PDF',
			contentType: 'application/pdf',
		});
		await activateOrganizer();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		let settingKey = `managed/${linked.libraryID}/${linked.key}`;
		let before = await readSetting(settingKey);

		await Zotero.AnnotationStorageCoordinator.applyChanges(linked.id, {
			upserts: [{
				id: Zotero.DataObjectUtilities.generateKey(),
				type: 'note',
				comment: 'Verified annotation edit',
				authorName: 'Migration safety test',
				dateModified: '2026-01-02T03:04:05.000Z',
				color: '#ffd400',
				pageLabel: '1',
				sortIndex: '00000|000000|00000',
				position: { pageIndex: 0, rects: [[50, 700, 72, 722]] },
				tags: [],
			}]
		});
		await Zotero.Reader.waitForAnnotationRecovery();
		let afterVerifiedWrite = await readSetting(settingKey);
		assert.isAbove(afterVerifiedWrite.revision, before.revision);
		assert.isNull(await readSetting(`orphan/${linked.libraryID}/${linked.key}`));
		createdItems.push(...linked.getAnnotations());

		let linkedPath = await linked.getFilePathAsync();
		await IOUtils.writeUTF8(linkedPath, 'unrelated external replacement');
		await Zotero.LinkedFolderAttachmentManager.notify('modify', 'file', [linked.id]);
		await new Promise(resolve => setTimeout(resolve, 50));
		let afterExternalReplacement = await readSetting(settingKey);
		let orphan = await readSetting(`orphan/${linked.libraryID}/${linked.key}`);
		assert.equal(afterExternalReplacement.revision, afterVerifiedWrite.revision);
		assert.equal(orphan.reason, 'managed-file-identity-mismatch-at-notification');
	});

	it('preserves old managed identity when a worker reports a changed file token', async function () {
		let parent = await makeArticle();
		let source = await makeAttachment(parent);
		await activateOrganizer();
		let linked = await Zotero.LinkedFolderAttachmentManager
			.convertStoredFileToLinkedFile(source.id);
		createdItems.push(linked);
		let settingKey = `managed/${linked.libraryID}/${linked.key}`;
		let before = await readSetting(settingKey);
		let linkedPath = await linked.getFilePathAsync();
		let error;
		try {
			await Zotero.LinkedFolderAttachmentManager.withManagedFileWrite(
				linked.id,
				async context => {
					await IOUtils.writeUTF8(linkedPath, 'worker changed the file');
					return {
						verifiedIdentity: {
							size: context.beforeIdentity.size,
							sha256: 'worker-file-token-no-longer-matches',
						},
					};
				}
			);
		}
		catch (e) {
			error = e;
		}
		assert.match(error?.message || '', /write was not verified/);
		let after = await readSetting(settingKey);
		let orphan = await readSetting(`orphan/${linked.libraryID}/${linked.key}`);
		assert.deepEqual({ size: after.size, sha256: after.sha256, revision: after.revision }, {
			size: before.size,
			sha256: before.sha256,
			revision: before.revision,
		});
		assert.equal(orphan.reason, 'managed-file-post-write-verification-failed');
		assert.deepEqual({ size: orphan.size, sha256: orphan.sha256 }, {
			size: before.size,
			sha256: before.sha256,
		});
		assert.isTrue(await IOUtils.exists(linkedPath));
	});

	it('keeps same-citation folders bounded while suffixing collisions', async function () {
		let first = await makeArticle('First collision article');
		let second = await makeArticle('Second collision article');
		sandbox.stub(Zotero.QuickCopy, 'getContentFromItems').returns({
			text: 'é'.repeat(100),
			html: '',
		});

		let firstFolder = await Zotero.LinkedFolderAttachmentManager
			.getOrCreateArticleFolder(first.id);
		let secondFolder = await Zotero.LinkedFolderAttachmentManager
			.getOrCreateArticleFolder(second.id);
		let firstName = PathUtils.filename(firstFolder);
		let secondName = PathUtils.filename(secondFolder);
		assert.notEqual(firstName, secondName);
		assert.isAtMost(Array.from(firstName).length, 100);
		assert.isAtMost(Array.from(secondName).length, 100);
		assert.match(secondName, / \(2\)$/u);
		assert.isTrue(await IOUtils.exists(firstFolder));
		assert.isTrue(await IOUtils.exists(secondFolder));
	});
});
