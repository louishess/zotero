#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || '');
assert(process.argv[2] && !output.startsWith(root + path.sep) && output !== root,
	'Provide an output directory outside the checkout');
assert(!fs.existsSync(output), 'Output directory must not already exist');
assert.equal(process.platform, 'darwin', 'This command packages macOS builds');
const source = JSON.parse(fs.readFileSync(path.join(root, 'integration/source-manifest.json')));
const run = (command, args, cwd = root, env = {}) => execFileSync(command, args, {
	cwd, env: { ...process.env, ...env }, stdio: 'inherit'
});
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Commit or preserve source changes before packaging');
run('node', ['scripts/verify-consolidation.cjs']);
run('npm', ['run', 'ftl-to-json']);
run('npm', ['run', 'build']);
assert.equal(git('status', '--porcelain'), '', 'Generated source differs from committed source');
run('app/scripts/dir_build', ['-p', 'm', '-f'], root, { ZOTERO_TEST: '0' });
run('./build.sh', ['-p', 'b', '-v', source.build.connectorVersion], path.join(root, 'connector'), {
	DEBUG: '', TEST_CHROME: '', TEST_FX: ''
});
fs.mkdirSync(output, { recursive: true });
const app = path.join(output, 'ZoteroMerge.app');
run('/usr/bin/ditto', [path.join(root, 'app/staging/Zotero.app'), app]);
// An ad-hoc executable has no Team ID for hardened-runtime library validation.
run('/usr/bin/codesign', ['--force', '--deep', '--options', '0', '--entitlements',
	path.join(root, 'app/mac/entitlements.xml'), '--sign', '-', app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const connector = path.join(output, 'ZoteroMerge-Connector');
fs.cpSync(path.join(root, 'connector/build/manifestv3'), connector, { recursive: true });
const manifestPath = path.join(connector, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
manifest.name = 'ZoteroMerge Connector';
assert.equal(manifest.version, source.build.connectorVersion);
assert.equal(manifest.manifest_version, 3);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
assert(!fs.existsSync(path.join(connector, 'test')), 'Do not ship Connector tests');
const omni = path.join(app, 'Contents/Resources/app/omni.ja');
const entries = execFileSync('unzip', ['-Z1', omni], { encoding: 'utf8' });
assert(entries.includes('chrome/content/zotero/xpcom/annotationStorageCoordinator.js'));
assert(entries.includes('resource/document-worker/worker.js'));
const worker = execFileSync('unzip', ['-p', omni, 'resource/document-worker/worker.js'], {
	encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
});
assert(!worker.includes(root), 'Packaged worker must not contain checkout-local paths');
assert(!/^test\//m.test(entries), 'Do not ship Desktop tests');
for (const [name, target] of [['ZoteroMerge-macOS.zip', 'ZoteroMerge.app'],
	['ZoteroMerge-Connector.zip', 'ZoteroMerge-Connector']]) {
	run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', target, name], output);
}
const hashes = {};
for (const filename of ['ZoteroMerge-macOS.zip', 'ZoteroMerge-Connector.zip']) {
	hashes[filename] = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, filename))).digest('hex');
}
const record = { commit: git('rev-parse', 'HEAD'), createdUTC: new Date().toISOString(),
	components: source.components, dependencies: source.dependencies,
	build: source.build, checksums: hashes, signing: 'macOS ad-hoc without hardened runtime; deep and strict verification passed',
	installed: false, reproducibility: 'Compare unpacked source/assets; ZIP timestamps and signatures are not byte-stable' };
fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(record, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS'), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}\n`).join(''));
console.log(JSON.stringify(record, null, 2));
