// Inventory source-declared preferences without registering or changing their defaults.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const entries = new Map();
const literal = node => node && ['StringLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(node.type)
	? node.value : undefined;
function member(node) {
	if (node?.type === 'Identifier') return node.name;
	if (node?.type === 'MemberExpression' && !node.computed) return `${member(node.object)}.${member(node.property)}`;
	return '';
}
function walk(node) {
	if (!node || typeof node !== 'object') return;
	if (node.type === 'CallExpression') {
		let call = member(node.callee);
		let [key, value, global] = node.arguments;
		let name = literal(key);
		let type;
		if (typeof name === 'string') {
			if (/^Zotero\.Prefs\.(get|set|clear|prefHasUserValue)$/.test(call)) {
				let isSet = call.endsWith('.set');
				name = (literal(isSet ? global : value) === true ? '' : 'extensions.zotero.') + name;
				if (isSet && literal(value) !== undefined) type = typeof literal(value);
			}
			else if (/^Services\.prefs\.(get|set)(Bool|Int|String|Char)Pref$/.test(call)) {
				type = call.includes('Bool') ? 'boolean' : call.includes('Int') ? 'number' : 'string';
			}
			else name = null;
			if (name) {
				let entry = entries.get(name) || { name };
				if (type) entry.type = type;
				entries.set(name, entry);
			}
		}
	}
	for (let value of Object.values(node)) {
		if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === 'object') walk(value);
	}
}
function scan(dir) {
	for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		let file = path.join(dir, entry.name);
		if (entry.isDirectory()) scan(file);
		else if (/\.(js|mjs|jsx)$/.test(file)) {
			let text = fs.readFileSync(file, 'utf8');
			if (!text.includes('Prefs.') && !text.includes('Services.prefs')) continue;
			walk(parser.parse(text, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true }));
		}
	}
}
scan(path.join(root, 'chrome/content/zotero'));
// Some translators read optional preferences that are absent from their header.
// Include those names as unset entries; installed translator defaults are merged
// at runtime, since the user's translator collection can differ from this build.
for (let file of fs.readdirSync(path.join(root, 'translators'))) {
	if (!file.endsWith('.js')) continue;
	let source = fs.readFileSync(path.join(root, 'translators', file), 'utf8');
	for (let match of source.matchAll(/\b(?:Z|Zotero)\.getHiddenPref\(\s*(["'])([^"']+)\1\s*\)/g)) {
		let name = `extensions.zotero.translators.${match[2]}`;
		if (!entries.has(name)) entries.set(name, { name });
	}
}
// These optional switches are only read, so their types cannot be inferred from writes.
for (let name of ['debug.memoryInfo', 'ui.tagsAfterTitle', 'sync.debugNoAutoResetClient', 'import.mendeleyUseOAuth']) {
	entries.set(`extensions.zotero.${name}`, { name: `extensions.zotero.${name}`, type: 'boolean' });
}
entries.set('extensions.zotero.sync.debugUploadPolicy', { name: 'extensions.zotero.sync.debugUploadPolicy', type: 'number' });
let output = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
fs.writeFileSync(path.join(root, 'resource/configEditorPrefs.json'), JSON.stringify(output, null, '\t') + '\n');
console.log(`Catalogued ${output.length} source-declared preferences`);
