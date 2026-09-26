const runEfficiencyAudit = Services.env.get('ZOTEROMERGE_AUDIT_OUTPUT') ? describe : describe.skip;

runEfficiencyAudit('ZoteroMerge audit diagnostics', function () {
	it('records canonical-root boundary behavior using only the disposable library', async function () {
		assert.isTrue(Zotero.automatedTest);
		let directory = await getTempDirectory();
		let alias = PathUtils.join(directory, 'data-alias');
		try {
			assert.isTrue(Zotero.File.createSymlink(Zotero.DataDirectory.dir, alias));
			let provider = Zotero.LinkedFolderProviders.get('local-folder');
			let direct = await provider.validateRoot(PathUtils.join(Zotero.DataDirectory.dir, 'storage'));
			let indirect = await provider.validateRoot(PathUtils.join(alias, 'storage'));
			assert.isFalse(direct.valid);
			let result = {
				direct: { valid: direct.valid, code: direct.code },
				ancestorSymlink: { valid: indirect.valid, code: indirect.code },
				boundaryBypassed: indirect.valid,
				runtime: Services.appinfo.platformVersion
			};
			await IOUtils.writeJSON(Services.env.get('ZOTEROMERGE_AUDIT_OUTPUT'), result);
			dump('AUDIT ' + JSON.stringify(result) + '\n');
		}
		finally {
			await IOUtils.remove(alias, { ignoreAbsent: true });
			await IOUtils.remove(directory, { recursive: true });
		}
	});
});
