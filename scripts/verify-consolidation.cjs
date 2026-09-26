const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../integration/source-manifest.json');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

for (const component of Object.values(manifest.components)) {
	git('merge-base', '--is-ancestor', component.importedRevision, 'HEAD');
	git('merge-base', '--is-ancestor', component.upstreamRevision, 'HEAD');
	if (component.path !== '.') {
		assert.match(git('ls-tree', 'HEAD', component.path), /^040000 tree /);
		assert.equal(fs.existsSync(path.join(root, component.path, '.git')), false);
	}
}

const registered = new Set(git('config', '--file', '.gitmodules', '--get-regexp', '^submodule\..*\.path$')
	.split('\n').map(line => line.slice(line.indexOf(' ') + 1)));
const gitlinks = git('ls-files', '--stage').split('\n').filter(line => line.startsWith('160000 '));
assert.equal(registered.size, gitlinks.length, 'Every pinned dependency must be registered at the root');
for (const line of gitlinks) {
	const [metadata, relative] = line.split('\t');
	const pin = metadata.split(' ')[1];
	assert.ok(registered.has(relative), relative);
	assert.equal(git('-C', relative, 'rev-parse', 'HEAD'), pin, relative);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, '.gitmodules'), 'utf8'), /louishess|file:\/\/|\/Users\//);

function translatorMetadata(file) {
	const source = fs.readFileSync(path.join(root, 'translators', file), 'utf8');
	return JSON.parse(source.match(/^\s*\{[\s\S]*?\}\s*\r?\n/)[0]);
}
const acs = translatorMetadata('ACS Publications.js');
const silverchair = translatorMetadata('Silverchair.js');
assert.ok(acs.priority < silverchair.priority, 'Custom ACS discovery must take precedence');
assert.ok(!fs.readFileSync(path.join(root, 'translators', 'deleted.txt'), 'utf8').includes(acs.translatorID));
assert.ok(new RegExp(acs.target).test('https://pubs.acs.org/jacs/article/148/1/1/123'));
assert.equal(git('rev-parse', 'HEAD:connector/src/zotero'), manifest.connectorDesktopPin);
console.log('Consolidation ancestry, source ownership, dependency pins and ACS retention verified.');
