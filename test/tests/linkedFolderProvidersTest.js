describe('Zotero.LinkedFolderProviders', function () {
	let tempDir;

	beforeEach(async function () {
		tempDir = await getTempDirectory();
	});

	afterEach(async function () {
		await removeDir(tempDir);
	});

	it('registers the mounted-folder provider profiles', function () {
		assert.deepEqual(
			Zotero.LinkedFolderProviders.getAll().map(provider => provider.id),
			['box-drive', 'dropbox', 'google-drive', 'local-folder']
		);
		for (let provider of Zotero.LinkedFolderProviders.getAll()) {
			assert.isString(provider.label);
			assert.isFunction(provider.detect);
			assert.isFunction(provider.validateRoot);
			assert.isString(provider.availabilityHint);
			assert.isTrue(Object.isFrozen(provider));
		}
	});

	it('detects current and legacy macOS cloud mount paths', function () {
		let home = OS.Constants.Path.homeDir;
		let cases = [
			[PathUtils.join(home, 'Library', 'CloudStorage', 'Box-Box', 'Zotero Attachments'), 'box-drive'],
			[PathUtils.join(home, 'Box', 'Zotero Attachments'), 'box-drive'],
			[PathUtils.join(home, 'Library', 'CloudStorage', 'Dropbox-Acme', 'Zotero'), 'dropbox'],
			[PathUtils.join(home, 'Dropbox (Personal)', 'Zotero'), 'dropbox'],
			[PathUtils.join(home, 'Library', 'CloudStorage', 'GoogleDrive-user@example.com', 'My Drive'), 'google-drive'],
			[PathUtils.join(home, 'Google Drive', 'Zotero'), 'google-drive'],
			[PathUtils.join(home, 'Documents', 'Zotero Attachments'), 'local-folder'],
		];

		for (let [path, expected] of cases) {
			assert.equal(Zotero.LinkedFolderProviders.detect(path).id, expected, path);
		}
	});

	it('does not match similarly prefixed ordinary folders', function () {
		let home = OS.Constants.Path.homeDir;
		assert.equal(
			Zotero.LinkedFolderProviders.detect(PathUtils.join(home, 'DropboxBackup')).id,
			'local-folder'
		);
		assert.equal(
			Zotero.LinkedFolderProviders.detect(PathUtils.join(home, 'Boxed')).id,
			'local-folder'
		);
	});

	it('validates a writable mounted directory without leaving its probe file', async function () {
		let provider = Zotero.LinkedFolderProviders.get('box-drive');
		let result = await provider.validateRoot(tempDir);

		assert.deepEqual(result, {
			valid: true,
			code: 'ok',
			path: tempDir,
		});
		assert.deepEqual(await IOUtils.getChildren(tempDir), []);
	});

	it('returns structured errors for unusable roots', async function () {
		let provider = Zotero.LinkedFolderProviders.get('local-folder');
		let missing = PathUtils.join(tempDir, 'missing');
		let file = PathUtils.join(tempDir, 'file');
		await IOUtils.writeUTF8(file, 'not a directory');

		assert.equal((await provider.validateRoot('')).code, 'invalid-path');
		assert.equal((await provider.validateRoot('relative/path')).code, 'not-absolute');
		assert.equal((await provider.validateRoot(missing)).code, 'missing');
		assert.equal((await provider.validateRoot(file)).code, 'not-directory');
	});

	it('rejects a root inside the Zotero data directory', async function () {
		let provider = Zotero.LinkedFolderProviders.get('local-folder');
		let path = PathUtils.join(Zotero.DataDirectory.dir, 'storage');
		let result = await provider.validateRoot(path);
		assert.equal(result.code, 'inside-data-directory');
	});

	it('falls back to the generic profile for invalid detection input', function () {
		assert.equal(Zotero.LinkedFolderProviders.detect(null).id, 'local-folder');
		assert.equal(Zotero.LinkedFolderProviders.get('missing'), null);
	});

	it('moves a file to the macOS Trash with a collision-safe destination', async function () {
		if (!Zotero.isMac) {
			this.skip();
		}

		let provider = Zotero.LinkedFolderProviders.get('box-drive');
		let source = PathUtils.join(tempDir, 'paper.pdf');
		await IOUtils.writeUTF8(source, 'pdf');
		let move = sinon.stub(Zotero.File, 'moveToUnique').resolves('/moved/paper.pdf');
		try {
			let result = await provider.moveToTrash(source);
			assert.equal(result, '/moved/paper.pdf');
			assert.equal(move.firstCall.args[0], source);
			assert.equal(
				move.firstCall.args[1],
				PathUtils.join(OS.Constants.Path.homeDir, '.Trash', 'paper.pdf')
			);
		}
		finally {
			move.restore();
		}
	});
});
