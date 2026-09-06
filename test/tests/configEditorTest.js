/* global describe, beforeEach, afterEach, it, assert, sinon, loadWindow, waitForCallback */
describe('Config Editor', function () {
	let win;
	let editor;
	const prefix = 'extensions.zotero.configEditorTest.';
	const optional = 'extensions.zotero.debug.memoryInfo';
	let optionalValue;
	beforeEach(async function () {
		optionalValue = Services.prefs.prefHasUserValue(optional) ? Services.prefs.getBoolPref(optional) : undefined;
		Services.prefs.clearUserPref(optional);
		win = await loadWindow('chrome://zotero/content/preferences/configEditor.xhtml');
		editor = win.Zotero_ConfigEditor;
		await waitForCallback(() => editor._observing, 100, 100);
	});
	afterEach(function () {
		if (win && !win.closed) win.close();
		Services.prefs.deleteBranch(prefix);
		Services.prefs.clearUserPref(optional);
		if (optionalValue !== undefined) Services.prefs.setBoolPref(optional, optionalValue);
	});
	function search(name) {
		win.document.getElementById('search').value = name;
		editor.render();
		return win.document.querySelector('.setting');
	}
	it('lists unset source preferences without creating values and toggles them with a pill switch', function () {
		let row = search(optional);
		assert.ok(row);
		assert.isFalse(Services.prefs.prefHasUserValue(optional));
		let toggle = row.querySelector('[role="switch"]');
		assert.ok(toggle);
		assert.equal(toggle.getAttribute('aria-checked'), 'false');
		toggle.click();
		assert.isTrue(Services.prefs.getBoolPref(optional));
		assert.equal(search(optional).querySelector('[role="switch"]').getAttribute('aria-checked'), 'true');
		search(optional).querySelector('[data-control="reset"]').click();
		assert.isFalse(Services.prefs.prefHasUserValue(optional));
		assert.ok(search(optional));
	});
	it('shows registered preferences outside Zotero and respects locked values', function () {
		Services.prefs.setBoolPref(prefix + 'locked', false);
		Services.prefs.lockPref(prefix + 'locked');
		try {
			let row = search(prefix + 'locked');
			assert.isTrue(row.querySelector('[role="switch"]').disabled);
			assert.throws(() => editor.set(prefix + 'locked', 'boolean', true));
			assert.isTrue(Services.prefs.prefHasUserValue(prefix + 'locked'));
			assert.ok(search('network.proxy.type'));
		}
		finally {
			Services.prefs.unlockPref(prefix + 'locked');
		}
	});
	it('validates integer and boolean input without changing an existing value', function () {
		editor.set(prefix + 'integer', 'number', '42');
		for (let value of ['1.5', '', '0x20', '2147483648', '-2147483649', 'Infinity']) {
			assert.throws(() => editor.set(prefix + 'integer', 'number', value));
		}
		assert.equal(Services.prefs.getIntPref(prefix + 'integer'), 42);
		assert.throws(() => editor.set(prefix + 'boolean', 'boolean', 'yes'));
		assert.isFalse(Services.prefs.prefHasUserValue(prefix + 'boolean'));
		editor.set(prefix + 'text', 'string', '<b>Literal text</b>');
		assert.equal(search(prefix + 'text').querySelector('input').value, '<b>Literal text</b>');
		assert.isNull(search(prefix + 'text').querySelector('b'));
	});
	it('refreshes external changes and preserves an unsaved edit while another setting changes', function () {
		editor.set(prefix + 'text', 'string', 'original');
		let input = search(prefix + 'text').querySelector('input');
		input.focus();
		input.value = 'unsaved';
		Services.prefs.setBoolPref(prefix + 'other', true);
		assert.equal(win.document.activeElement.value, 'unsaved');
		win.document.getElementById('search').focus();
		Services.prefs.setStringPref(prefix + 'text', 'external');
		assert.equal(search(prefix + 'text').querySelector('input').value, 'external');
	});
	it('merges hidden translator defaults without writing them to preferences', async function () {
		let scope = { Zotero, Services, document: win.document };
		Services.scriptloader.loadSubScript('chrome://zotero/content/preferences/configEditor.js', scope);
		let stub = sinon.stub(Zotero.Translators, 'getAll').resolves([
			{ hiddenPrefs: { configEditorTestHidden: true } },
		]);
		try {
			await scope.Zotero_ConfigEditor.init();
			let name = 'extensions.zotero.translators.configEditorTestHidden';
			let entry = scope.Zotero_ConfigEditor.read(name);
			assert.isTrue(entry.unset);
			assert.isTrue(entry.value);
			assert.equal(entry.type, 'boolean');
			assert.isFalse(Services.prefs.prefHasUserValue(name));
		}
		finally {
			scope.Zotero_ConfigEditor.uninit();
			stub.restore();
		}
	});
});
