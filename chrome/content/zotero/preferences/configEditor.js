/* Config Editor: enumerate preferences without creating defaults or user values. */
/* exported Zotero_ConfigEditor */
var Zotero_ConfigEditor = { // eslint-disable-line no-unused-vars -- Used by the XUL window
	_catalog: new Map(),
	_limit: 100,
	_observing: false,
	async init() {
		document.title = this.text('title');
		try {
			let response = await Zotero.HTTP.request('GET', 'resource://zotero/configEditorPrefs.json');
			let catalog = JSON.parse(response.responseText);
			for (let entry of catalog) this._catalog.set(entry.name, entry);
			for (let translator of await Zotero.Translators.getAll()) {
				for (let [key, value] of Object.entries(translator.hiddenPrefs || {})) {
					if (!['boolean', 'string', 'number'].includes(typeof value)) continue;
					let name = `extensions.zotero.translators.${key}`;
					let entry = this._catalog.get(name);
					if (entry && entry.value !== undefined && entry.value !== value) {
						// A shared hidden key can have different per-translator defaults.
						delete entry.value;
						entry.mixed = true;
					}
					else if (!entry?.mixed) this._catalog.set(name, { name, type: typeof value, value });
				}
			}
		}
		catch (e) {
			Zotero.logError(e);
			this.error(this.text('unavailable'));
		}
		this._observer = { observe: () => this.render() };
		Services.prefs.addObserver('', this._observer);
		this._observing = true;
		for (let id of ['search', 'scope']) {
			document.getElementById(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
				this._limit = 100;
				this.render();
			});
		}
		document.getElementById('more').addEventListener('click', () => {
			this._limit += 100;
			this.render();
		});
		document.getElementById('add-form').addEventListener('submit', (event) => {
			event.preventDefault();
			try {
				let name = document.getElementById('new-name').value.trim();
				if (!name || /\s/.test(name)) throw new Error(this.text('invalid-name'));
				if (Services.prefs.getPrefType(name) || this._catalog.has(name)) throw new Error(this.text('existing'));
				this.set(name, document.getElementById('new-type').value, document.getElementById('new-value').value);
				document.getElementById('search').value = name;
				document.getElementById('scope').value = 'all';
				this.render();
			}
			catch (e) {
				this.error(e.message);
			}
		});
		this.render();
		document.getElementById('search').focus();
	},
	uninit() {
		if (this._observing) Services.prefs.removeObserver('', this._observer);
		this._observing = false;
	},
	text(key, args) {
		return Zotero.ftl.formatValueSync(`config-editor-${key}`, args);
	},
	element(tag, text, className) {
		let node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		return node;
	},
	error(message) {
		let node = document.getElementById('error');
		node.textContent = message;
		node.hidden = !message;
	},
	read(name) {
		let prefType = Services.prefs.getPrefType(name);
		let entry = this._catalog.get(name) || {};
		let type = prefType === Services.prefs.PREF_BOOL
			? 'boolean'
			: prefType === Services.prefs.PREF_INT
				? 'number'
				: prefType === Services.prefs.PREF_STRING ? 'string' : entry.type;
		let value = entry.value;
		try {
			if (prefType) value = Zotero.Prefs.get(name, true);
		}
		catch {
			// A locked user-only preference can have a type but no readable default.
			// Keep its row available without breaking the rest of the editor.
		}
		return { name, type, value, unset: !prefType,
			modified: Services.prefs.prefHasUserValue(name), locked: Services.prefs.prefIsLocked(name) };
	},
	set(name, type, raw) {
		if (Services.prefs.prefIsLocked(name)) throw new Error(this.text('state-locked'));
		let value = raw;
		if (type === 'boolean') {
			if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') throw new Error(this.text('invalid-boolean'));
			value = raw === true || raw === 'true';
		}
		else if (type === 'number') {
			if (!/^-?\d+$/.test(String(raw))) throw new Error(this.text('invalid-integer'));
			value = Number(raw);
			if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error(this.text('invalid-integer'));
		}
		else if (type !== 'string') throw new Error(this.text('type'));
		Zotero.Prefs.set(name, value, true);
		this.error('');
	},
	render() {
		let names = new Set([...Services.prefs.getChildList(''), ...this._catalog.keys()]);
		let query = document.getElementById('search').value.trim().toLowerCase();
		let scope = document.getElementById('scope').value;
		let matches = [...names].sort().map(name => this.read(name)).filter((entry) => {
			if (scope === 'zotero' && !entry.name.startsWith('extensions.zotero.')) return false;
			if (scope === 'modified' && !entry.modified) return false;
			if (scope === 'optional' && !entry.unset) return false;
			return !query || entry.name.toLowerCase().includes(query) || String(entry.value ?? '').toLowerCase().includes(query);
		});
		let container = document.getElementById('settings');
		// Preserve focus and unsaved text while unrelated preferences change.
		let focused = document.activeElement;
		let focusName = focused?.closest('.setting')?.dataset.name;
		let focusRole = focused?.dataset.control;
		let draft = focused?.tagName.toLowerCase() === 'input' ? focused.value : undefined;
		let selection = draft !== undefined ? [focused.selectionStart, focused.selectionEnd] : null;
		container.replaceChildren(...matches.slice(0, this._limit).map(entry => this.row(entry)));
		document.getElementById('count').textContent = this.text('count', { shown: Math.min(this._limit, matches.length), total: matches.length });
		document.getElementById('more').hidden = matches.length <= this._limit;
		if (focusName && focusRole) {
			let row = [...container.children].find(node => node.dataset.name === focusName);
			let control = row?.querySelector(`[data-control="${focusRole}"]`);
			if (control) {
				if (draft !== undefined) control.value = draft;
				control.focus({ preventScroll: true });
				if (selection && control.type === 'text') control.setSelectionRange(...selection);
			}
		}
	},
	row(entry) {
		let { name, type, value, modified, locked, unset } = entry;
		let row = this.element('div', undefined, 'setting');
		row.dataset.name = name;
		let label = this.element('div');
		let title = name.replace(/^extensions\.zotero\./, '').split('.').map((part) => {
			let words = part.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
			words = words.charAt(0).toUpperCase() + words.slice(1);
			return words.replace(/\b(pdf|docx|xlsx|mp3|mp4|webm|url|api|doi)\b/gi, word => word.toUpperCase());
		})
.join(' › ');
		label.append(this.element('div', title, 'setting-title'));
		label.append(this.element('div', name, 'name'));
		label.append(this.element('div', this.text(`state-${locked ? 'locked' : unset ? 'unset' : modified ? 'changed' : 'default'}`), 'state'));
		let editor = this.element('div', undefined, 'editor');
		if (type === 'boolean') {
			let toggle = this.element('button', this.text(value === true ? 'yes' : 'no'), 'switch');
			toggle.setAttribute('role', 'switch');
			toggle.setAttribute('aria-checked', String(value === true));
			toggle.setAttribute('aria-label', name);
			toggle.dataset.control = 'value';
			toggle.disabled = locked;
			toggle.addEventListener('click', () => {
				try {
					this.set(name, 'boolean', value !== true);
				}
				catch (e) {
					this.error(e.message);
				}
			});
			editor.append(toggle);
		}
		else {
			let input = this.element('input');
			input.type = 'text';
			input.value = value ?? '';
			input.disabled = locked;
			input.dataset.control = 'value';
			input.setAttribute('aria-label', name);
			let selector;
			if (!type) {
				selector = this.element('select');
				selector.setAttribute('aria-label', `${name} (${this.text('string')} / ${this.text('number')} / ${this.text('boolean')})`);
				for (let key of ['string', 'number', 'boolean']) {
					let option = this.element('option', this.text(key));
					option.value = key;
					selector.append(option);
				}
				editor.append(selector);
			}
			let save = this.element('button', this.text('save'));
			save.disabled = locked;
			save.dataset.control = 'save';
			let commit = () => {
				try {
					this.set(name, type || selector.value, input.value);
				}
				catch (e) {
					this.error(e.message);
				}
			};
			save.addEventListener('click', commit);
			input.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') commit();
			});
			editor.append(input, save);
		}
		let reset = this.element('button', this.text('reset'));
		reset.dataset.control = 'reset';
		reset.setAttribute('aria-label', `${this.text('reset')} ${name}`);
		reset.disabled = locked || !modified;
		reset.addEventListener('click', () => {
			try {
				Services.prefs.clearUserPref(name); this.error('');
			}
			catch (e) {
				this.error(e.message);
			}
		});
		row.append(label, editor, reset);
		return row;
	},
};
