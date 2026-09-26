const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getSourceHash } = require('../js-build/document-worker');

test('owned worker cache follows source and dependency contents, not enclosing HEAD', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zoteromerge-worker-hash-'));
	const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
	const init = cwd => {
		git(cwd, 'init', '-q');
		git(cwd, 'config', 'user.name', 'Cache Test');
		git(cwd, 'config', 'user.email', 'cache-test@example.invalid');
	};
	try {
		init(root);
		const worker = path.join(root, 'document-worker');
		await fs.mkdir(worker);
		await fs.writeFile(path.join(worker, 'worker.js'), 'initial');
		await fs.writeFile(path.join(worker, '.gitignore'), 'build/\n');
		git(root, 'add', '.');
		git(root, 'commit', '-qm', 'Initial worker');
		const original = await getSourceHash(worker);
		await fs.writeFile(path.join(root, 'unrelated'), 'unrelated');
		git(root, 'add', 'unrelated');
		git(root, 'commit', '-qm', 'Unrelated Desktop change');
		assert.equal(await getSourceHash(worker), original);
		await fs.writeFile(path.join(worker, 'worker.js'), 'edited');
		const edited = await getSourceHash(worker);
		assert.notEqual(edited, original);
		await fs.writeFile(path.join(worker, 'new-source.js'), 'new');
		const added = await getSourceHash(worker);
		assert.notEqual(added, edited);
		await fs.mkdir(path.join(worker, 'build'));
		await fs.writeFile(path.join(worker, 'build', 'worker.js'), 'ignored output');
		assert.equal(await getSourceHash(worker), added);
		const dependency = path.join(worker, 'dependency');
		await fs.mkdir(dependency);
		init(dependency);
		await fs.writeFile(path.join(dependency, 'source.js'), 'dependency');
		git(dependency, 'add', '.');
		git(dependency, 'commit', '-qm', 'Dependency');
		git(root, 'update-index', '--add', '--cacheinfo', '160000', git(dependency, 'rev-parse', 'HEAD'), 'document-worker/dependency');
		const pinned = await getSourceHash(worker);
		assert.notEqual(pinned, added);
		await fs.writeFile(path.join(dependency, 'source.js'), 'dirty dependency');
		await assert.rejects(getSourceHash(worker), /uncommitted source changes/);
		git(dependency, 'add', '.');
		git(dependency, 'commit', '-qm', 'Dependency update');
		assert.notEqual(await getSourceHash(worker), pinned);
	}
	finally { await fs.rm(root, { recursive: true, force: true }); }
});
