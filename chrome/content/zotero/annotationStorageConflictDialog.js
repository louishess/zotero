Zotero.AnnotationStorageConflictDialog = {
	init() {
		this.io = window.arguments[0];
		this.io.resolutions = null;
		this._groups = [];

		let container = document.getElementById('annotation-storage-conflicts');
		for (let [index, conflict] of this.io.conflicts.entries()) {
			let box = document.createXULElement('groupbox');
			box.dataset.conflictID = conflict.id;

			let heading = document.createXULElement('label');
			let annotation = conflict.pdf || conflict.zotero || {};
			let pageLabel = annotation.pageLabel || annotation.position?.pageIndex + 1 || '';
			heading.value = Zotero.ftl.formatValueSync('annotation-storage-conflict-item', {
				index: index + 1,
				type: annotation.type || '',
				page: pageLabel,
			});
			box.append(heading);

			let group = document.createXULElement('radiogroup');
			group.setAttribute('orient', 'horizontal');
			group.dataset.conflictID = conflict.id;
			for (let [value, l10nID] of [
				['pdf', 'annotation-storage-conflict-use-pdf'],
				['zotero', 'annotation-storage-conflict-use-zotero'],
			]) {
				let radio = document.createXULElement('radio');
				radio.value = value;
				radio.dataset.l10nId = l10nID;
				group.append(radio);
			}
			group.addEventListener('command', () => this._updateAcceptState());
			box.append(group);
			container.append(box);
			this._groups.push(group);
		}

		document.addEventListener('dialogaccept', event => this.accept(event));
		document.addEventListener('dialogcancel', () => this.cancel());
		this._updateAcceptState();
	},

	_updateAcceptState() {
		document.getElementById('annotation-storage-conflict-dialog')
			.getButton('accept').disabled = this._groups.some(group => !group.value);
	},

	accept(event) {
		if (this._groups.some(group => !group.value)) {
			event.preventDefault();
			return;
		}
		this.io.resolutions = Object.fromEntries(
			this._groups.map(group => [group.dataset.conflictID, group.value])
		);
	},

	cancel() {
		this.io.resolutions = null;
	},
};
