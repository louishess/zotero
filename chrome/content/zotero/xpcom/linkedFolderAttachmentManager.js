/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2026 Corporation for Digital Scholarship
                     Vienna, Virginia, Austria
                     https://www.zotero.org

    This file is part of Zotero.

    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with Zotero. If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

/**
 * Convert stored journal-article PDFs to relative linked files in a mounted
 * cloud folder. The filesystem is deliberately the only provider contract:
 * Zotero data sync continues to distribute attachment items and their
 * `attachments:` paths, while Box Drive, Dropbox, Google Drive, or another
 * folder synchronizer distributes the bytes.
 */
Zotero.LinkedFolderAttachmentManager = new function () {
	const SETTING = 'linkedFolderAttachmentManager';
	const PREF_ENABLED = 'linkedFolderAttachments.enabled';
	const PREF_PROVIDER = 'linkedFolderAttachments.provider';
	const JOB_PREFIX = 'job/';
	const FOLDER_PREFIX = 'folder/';
	const MANAGED_PREFIX = 'managed/';
	const ORPHAN_PREFIX = 'orphan/';
	const FORMAT = 'bibliography=http://www.zotero.org/styles/american-chemical-society';
	const MAX_FOLDER_CODE_POINTS = 100;
	const PDF_CONTENT_TYPES = new Set([
		'application/pdf',
		'application/x-pdf',
		'application/acrobat',
		'applications/vnd.pdf',
		'text/pdf',
		'text/x-pdf',
	]);
	const WAITING_PHASES = new Set(['waiting-source', 'waiting-reader', 'waiting-root']);
	const FINAL_PHASES = new Set(['complete', 'conflict']);

	let _initialized = false;
	let _paused = false;
	let _observerID;
	let _prefObserverIDs = [];
	let _queues = new Map();
	let _startupTimer;

	function _now() {
		return new Date().toISOString();
	}

	function _settingKey(prefix, libraryID, key) {
		return `${prefix}${libraryID}/${key}`;
	}

	async function _readSetting(key) {
		let value = await Zotero.DB.valueQueryAsync(
			'SELECT value FROM settings WHERE setting=? AND key=?',
			[SETTING, key]
		);
		if (!value) return null;
		try {
			return JSON.parse(value);
		}
		catch (e) {
			Zotero.logError(e);
			return null;
		}
	}

	async function _writeSetting(key, value) {
		value.updatedAt = _now();
		await Zotero.DB.queryAsync(
			'REPLACE INTO settings (setting, key, value) VALUES (?, ?, ?)',
			[SETTING, key, JSON.stringify(value)]
		);
		return value;
	}

	async function _deleteSetting(key) {
		await Zotero.DB.queryAsync(
			'DELETE FROM settings WHERE setting=? AND key=?',
			[SETTING, key]
		);
	}

	function _getRoot() {
		let path = Zotero.Prefs.get('baseAttachmentPath');
		return typeof path == 'string' && path ? PathUtils.normalize(path) : null;
	}

	function _getProvider(root) {
		return Zotero.LinkedFolderProviders.get(Zotero.Prefs.get(PREF_PROVIDER))
			|| Zotero.LinkedFolderProviders.detect(root);
	}

	function _isPDF(item) {
		if (!item?.isAttachment() || !item.isFileAttachment()) return false;
		let contentType = (item.attachmentContentType || '').toLowerCase().split(';', 1)[0];
		return PDF_CONTENT_TYPES.has(contentType)
			|| (item.attachmentFilename || '').toLowerCase().endsWith('.pdf');
	}

	function _isOpenInReader(itemID) {
		return !!Zotero.Reader?._readers?.some(
			reader => reader.itemID == itemID && !reader._isTabClosed
		);
	}

	function _normalizeText(value) {
		return (value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
	}

	function _truncateCodePoints(value, max) {
		return Array.from(value).slice(0, max).join('');
	}

	function _guardReservedName(value) {
		let base = value.split('.', 1)[0];
		if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) {
			return `_${value}`;
		}
		return value;
	}

	function _sanitizeName(value, { fallback, maxCodePoints }) {
		value = _normalizeText(value)
			.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '-')
			.replace(/-+/gu, '-')
			.replace(/[ .]+$/gu, '')
			.trim();
		value = _guardReservedName(value || fallback);
		value = _truncateCodePoints(value, maxCodePoints).replace(/[ .]+$/gu, '');
		return value || fallback;
	}

	function _sanitizeFolderName(value) {
		value = _normalizeText(value)
			.replace(/^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/u, '');
		return _sanitizeName(value, {
			fallback: 'Untitled Article',
			maxCodePoints: MAX_FOLDER_CODE_POINTS,
		});
	}

	function _sanitizeFilename(value) {
		let cleaned = _sanitizeName(value, { fallback: 'attachment.pdf', maxCodePoints: 180 });
		if (!/\.pdf$/iu.test(cleaned)) cleaned += '.pdf';
		return cleaned;
	}

	async function _sha256File(path) {
		let hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
		hash.init(hash.SHA256);
		let stream = Cc['@mozilla.org/network/file-input-stream;1']
			.createInstance(Ci.nsIFileInputStream);
		try {
			stream.init(Zotero.File.pathToFile(path), -1, -1, Ci.nsIFileInputStream.CLOSE_ON_EOF);
			hash.updateFromStream(stream, -1);
			let binary = hash.finish(false);
			return Array.from(
				binary,
				(_, i) => binary.charCodeAt(i).toString(16).padStart(2, '0')
			).join('');
		}
		finally {
			stream.close();
		}
	}

	async function _fileIdentity(path) {
		let { size } = await IOUtils.stat(path);
		return { size, sha256: await _sha256File(path) };
	}

	function _sameIdentity(a, b) {
		return !!a && !!b && a.size == b.size && a.sha256 == b.sha256;
	}

	async function _eligibleItem(item) {
		if (!item || item.deleted || item.libraryID != Zotero.Libraries.userLibraryID
				|| !item.isStoredFileAttachment() || !_isPDF(item) || !item.parentItemID) {
			return false;
		}
		let parent = item.parentItem;
		return !!parent && !parent.deleted && parent.itemType == 'journalArticle';
	}

	async function _citationFolderName(parent) {
		try {
			let output = Zotero.QuickCopy.getContentFromItems([parent], FORMAT);
			if (output?.text) return _sanitizeFolderName(output.text);
		}
		catch (e) {
			Zotero.logError(e);
		}
		let fallback = [
			parent.getField('firstCreator'),
			parent.getField('year'),
			parent.getField('title'),
		].filter(Boolean).join('. ');
		return _sanitizeFolderName(fallback);
	}

	async function _folderForLinkedChild(parent) {
		let root = _getRoot();
		if (!root) return null;
		for (let attachment of Zotero.Items.get(parent.getAttachments(false))) {
			if (!attachment.isLinkedFileAttachment() || !_isPDF(attachment)) continue;
			let relative = attachment.attachmentPath;
			if (!relative?.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) continue;
			let absolute = Zotero.Attachments.resolveRelativePath(relative);
			if (!absolute || !Zotero.File.directoryContains(root, absolute)) continue;
			let folder = PathUtils.parent(absolute);
			if (folder != root) return folder;
		}
		return null;
	}

	function _relativeToRoot(root, path) {
		root = PathUtils.normalize(root).replace(/\\/g, '/').replace(/\/$/u, '');
		path = PathUtils.normalize(path).replace(/\\/g, '/');
		if (!path.startsWith(`${root}/`)) {
			throw new Error('Path is outside the linked attachment base directory');
		}
		return path.slice(root.length + 1);
	}

	async function _chooseArticleFolder(parent) {
		let mappingKey = _settingKey(FOLDER_PREFIX, parent.libraryID, parent.key);
		let root = _getRoot();
		let stored = await _readSetting(mappingKey);
		if (stored?.relativePath) {
			let folder = PathUtils.joinRelative(root, stored.relativePath);
			await IOUtils.makeDirectory(folder, { createAncestors: true });
			return folder;
		}

		let reused = await _folderForLinkedChild(parent);
		if (reused) {
			let relativePath = _relativeToRoot(root, reused);
			await _writeSetting(mappingKey, { v: 1, relativePath });
			return reused;
		}

		let base = await _citationFolderName(parent);
		let name = base;
		for (let index = 2; await IOUtils.exists(PathUtils.join(root, name)); index++) {
			name = `${base} (${index})`;
		}
		let folder = PathUtils.join(root, name);
		await IOUtils.makeDirectory(folder, { createAncestors: true });
		await _writeSetting(mappingKey, { v: 1, relativePath: name });
		return folder;
	}

	async function _chooseTarget(folder, filename, sourceIdentity) {
		let parsed = PathUtils.filename(filename);
		let extension = /\.pdf$/iu.test(parsed) ? parsed.slice(-4) : '.pdf';
		let base = parsed.slice(0, parsed.length - extension.length) || 'attachment';
		for (let index = 1; ; index++) {
			let candidate = PathUtils.join(folder, index == 1 ? `${base}${extension}` : `${base} (${index})${extension}`);
			if (!(await IOUtils.exists(candidate))) return { path: candidate, reuse: false };
			if (_sameIdentity(await _fileIdentity(candidate), sourceIdentity)) {
				return { path: candidate, reuse: true };
			}
		}
	}

	async function _saveJob(job) {
		return _writeSetting(_settingKey(JOB_PREFIX, job.libraryID, job.sourceKey), job);
	}

	async function _loadOrCreateJob(item, reason) {
		let key = _settingKey(JOB_PREFIX, item.libraryID, item.key);
		let job = await _readSetting(key);
		if (!job) {
			job = {
				v: 1,
				libraryID: item.libraryID,
				sourceKey: item.key,
				parentKey: item.parentKey,
				phase: 'queued',
				reason,
				attempts: 0,
			};
			await _saveJob(job);
		}
		return job;
	}

	async function _setPhase(job, phase, changes = {}) {
		Object.assign(job, changes, { phase });
		await _saveJob(job);
	}

	async function _ensureSource(job, source) {
		let path = source && await source.getFilePathAsync();
		if (path && await IOUtils.exists(path)) return path;

		let policy = Zotero.AutomaticAttachmentDownloads;
		if (!policy || policy.isTypeEnabled('pdf')) {
			try {
				await Zotero.Sync.Runner.downloadFile(source);
				path = await source.getFilePathAsync();
				if (path && await IOUtils.exists(path)) return path;
			}
			catch (e) {
				Zotero.debug(e, 2);
			}
		}
		await _setPhase(job, 'waiting-source', { lastError: null });
		return null;
	}

	async function _copyAndVerify(job, sourcePath) {
		let sourceIdentity = job.sourceSHA256
			? { size: job.sourceSize, sha256: job.sourceSHA256 }
			: await _fileIdentity(sourcePath);
		if (!job.sourceSHA256) {
			Object.assign(job, {
				sourceSize: sourceIdentity.size,
				sourceSHA256: sourceIdentity.sha256,
			});
		}

		let targetPath = job.targetPath;
		let tempPath = `${targetPath}.zotero-part-${job.sourceKey}`;
		if (await IOUtils.exists(targetPath)) {
			if (!_sameIdentity(await _fileIdentity(targetPath), sourceIdentity)) {
				throw new Error('Destination file changed after it was selected');
			}
			await _setPhase(job, 'copy-verified');
			return;
		}

		if (await IOUtils.exists(tempPath)) {
			if (!_sameIdentity(await _fileIdentity(tempPath), sourceIdentity)) {
				await IOUtils.remove(tempPath);
			}
		}
		if (!(await IOUtils.exists(tempPath))) {
			await IOUtils.copy(sourcePath, tempPath, { noOverwrite: true });
		}
		await _setPhase(job, 'copied-temp');
		if (!_sameIdentity(await _fileIdentity(tempPath), sourceIdentity)) {
			throw new Error('Temporary cloud copy failed SHA-256 verification');
		}
		await IOUtils.move(tempPath, targetPath, { noOverwrite: true });
		if (!_sameIdentity(await _fileIdentity(targetPath), sourceIdentity)) {
			throw new Error('Cloud copy failed SHA-256 verification after rename');
		}
		await _setPhase(job, 'copy-verified');
	}

	async function _createLinkedItem(job, source) {
		let existing = await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.newAttachmentKey);
		if (existing) {
			if (!existing.isLinkedFileAttachment() || existing.attachmentPath != job.targetRelativePath) {
				await _setPhase(job, 'conflict', {
					lastError: 'The planned attachment key is already used by a different item',
				});
				throw new Error(job.lastError);
			}
			if (['copy-verified', 'target-selected', 'copied-temp'].includes(job.phase)) {
				await _setPhase(job, 'linked-item-created', { linkedItemID: existing.id });
			}
			return existing;
		}

		// Data sync may deliver another migration owner's replacement before
		// this client creates its planned item. Adopt an unambiguous replacement
		// that points at the exact verified relative path.
		let replacements = Zotero.Items.get(source.parentItem.getAttachments(false)).filter(
			item => item.isLinkedFileAttachment()
				&& item.attachmentPath == job.targetRelativePath
		);
		if (replacements.length == 1) {
			existing = replacements[0];
			job.newAttachmentKey = existing.key;
			await _setPhase(job, 'linked-item-created', {
				linkedItemID: existing.id,
				adoptedSyncedReplacement: true,
			});
			return existing;
		}
		if (replacements.length > 1) {
			await _setPhase(job, 'conflict', {
				lastError: 'Multiple linked replacements refer to the same managed cloud file',
				conflictingAttachmentKeys: replacements.map(item => item.key),
			});
			throw new Error(job.lastError);
		}

		let json = source.toJSON({ skipStorageProperties: true });
		delete json.key;
		delete json.version;
		delete json.filename;
		delete json.mtime;
		delete json.md5;
		json.linkMode = 'linked_file';
		json.path = job.targetRelativePath;

		let linked = new Zotero.Item('attachment');
		linked.libraryID = source.libraryID;
		linked.key = job.newAttachmentKey;
		linked.fromJSON(json);
		await linked.saveTx({
			notifierData: { linkedFolderAttachmentManager: true, sourceKey: source.key },
		});
		await _setPhase(job, 'linked-item-created', { linkedItemID: linked.id });
		return linked;
	}

	async function _transferChildrenAndIndexes(job, source, linked) {
		let duplicateReplacements = Zotero.Items.get(source.parentItem.getAttachments(false)).filter(
			item => item.id != linked.id
				&& item.isLinkedFileAttachment()
				&& item.attachmentPath == job.targetRelativePath
		);
		if (duplicateReplacements.length) {
			await _setPhase(job, 'conflict', {
				lastError: 'Another client created a conflicting linked replacement',
				conflictingAttachmentKeys: [linked.key, ...duplicateReplacements.map(item => item.key)],
			});
			throw new Error(job.lastError);
		}
		if (job.phase == 'linked-item-created') {
			await Zotero.DB.executeTransaction(async () => {
				await Zotero.Items.moveChildItems(source, linked);
			});
			await Zotero.Relations.copyObjectSubjectRelations(source, linked);
			try {
				await Zotero.DB.executeTransaction(async () => {
					await Zotero.Fulltext.transferItemIndex(source, linked);
				});
			}
			catch (e) {
				// The linked file remains usable and can be reindexed if an old index
				// cannot be transferred.
				Zotero.logError(e);
			}
			await _setPhase(job, 'children-transferred');
		}

		let linkedPath = await linked.getFilePathAsync();
		if (!linkedPath || !_sameIdentity(await _fileIdentity(linkedPath), {
			size: job.sourceSize,
			sha256: job.sourceSHA256,
		})) {
			throw new Error('The new relative linked attachment could not be reopened and verified');
		}

		if (Zotero.AnnotationStorageCoordinator?.clearLocalState) {
			await Zotero.AnnotationStorageCoordinator.clearLocalState(source.id);
		}
		if (source.id) {
			await source.eraseTx({
				notifierData: { linkedFolderAttachmentManager: true, replacementKey: linked.key },
			});
		}
		await _setPhase(job, 'source-erased');

		await _writeSetting(_settingKey(MANAGED_PREFIX, linked.libraryID, linked.key), {
			v: 1,
			libraryID: linked.libraryID,
			attachmentKey: linked.key,
			parentKey: job.parentKey,
			relativePath: job.targetRelativePath,
			providerID: _getProvider(_getRoot()).id,
			sha256: job.sourceSHA256,
			size: job.sourceSize,
		});
		await _setPhase(job, 'complete', { lastError: null });
		return linked;
	}

	async function _processJob(itemID, reason) {
		if (_paused || !Zotero.Prefs.get(PREF_ENABLED)) return false;
		let source = await Zotero.Items.getAsync(itemID);
		if (!await _eligibleItem(source)) return false;
		let job = await _loadOrCreateJob(source, reason);
		if (job.phase == 'complete') return Zotero.Items.getByLibraryAndKey(job.libraryID, job.newAttachmentKey);
		if (job.phase == 'conflict') return false;

		job.attempts = (job.attempts || 0) + 1;
		job.lastError = null;
		await _saveJob(job);
		try {
			let root = _getRoot();
			let provider = root && _getProvider(root);
			let validation = provider && await provider.validateRoot(root);
			if (!validation?.valid) {
				await _setPhase(job, 'waiting-root', {
					lastError: validation ? validation.code : 'missing-root',
				});
				return false;
			}
			Zotero.Prefs.set('saveRelativeAttachmentPath', true);

			if (_isOpenInReader(source.id)) {
				await _setPhase(job, 'waiting-reader', { lastError: null });
				return false;
			}
			let sourcePath = await _ensureSource(job, source);
			if (!sourcePath) return false;

			if (!job.targetPath) {
				let folder = await _chooseArticleFolder(source.parentItem);
				let sourceIdentity = await _fileIdentity(sourcePath);
				let target = await _chooseTarget(
					folder,
					_sanitizeFilename(source.attachmentFilename || PathUtils.filename(sourcePath)),
					sourceIdentity
				);
				let relative = Zotero.Attachments.getBaseDirectoryRelativePath(target.path);
				if (!relative.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) {
					throw new Error('Selected destination is outside the linked attachment base directory');
				}
				await _setPhase(job, 'target-selected', {
					targetFolder: folder,
					targetFilename: PathUtils.filename(target.path),
					targetPath: target.path,
					targetRelativePath: relative,
					sourceSize: sourceIdentity.size,
					sourceSHA256: sourceIdentity.sha256,
					newAttachmentKey: job.newAttachmentKey || Zotero.DataObjectUtilities.generateKey(),
				});
			}

			if (['target-selected', 'copied-temp', 'waiting-source', 'waiting-reader', 'waiting-root'].includes(job.phase)) {
				await _copyAndVerify(job, sourcePath);
			}
			let linked = await _createLinkedItem(job, source);
			return _transferChildrenAndIndexes(job, source, linked);
		}
		catch (e) {
			Zotero.logError(e);
			if (job.phase != 'conflict') {
				job.lastError = e.message || String(e);
				await _saveJob(job);
			}
			return false;
		}
	}

	async function _resumeJob(job, reason) {
		let source = await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.sourceKey);
		if (source) return this.queueAttachment(source.id, reason);
		let linked = job.newAttachmentKey
			&& await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.newAttachmentKey);
		if (linked?.isLinkedFileAttachment()) {
			let path = await linked.getFilePathAsync();
			if (path && _sameIdentity(await _fileIdentity(path), {
				size: job.sourceSize,
				sha256: job.sourceSHA256,
			})) {
				await _writeSetting(_settingKey(MANAGED_PREFIX, linked.libraryID, linked.key), {
					v: 1,
					libraryID: linked.libraryID,
					attachmentKey: linked.key,
					parentKey: job.parentKey,
					relativePath: job.targetRelativePath,
					providerID: _getProvider(_getRoot()).id,
					sha256: job.sourceSHA256,
					size: job.sourceSize,
				});
				await _setPhase(job, 'complete', { lastError: null });
				return linked;
			}
		}
		return false;
	}

	async function _getRows(prefix = '') {
		return Zotero.DB.queryAsync(
			'SELECT key, value FROM settings WHERE setting=? AND key LIKE ?',
			[SETTING, `${prefix}%`]
		);
	}

	async function _collectManagedItems(items) {
		let attachmentsByID = new Map();
		for (let item of items) {
			if (item.isLinkedFileAttachment()) attachmentsByID.set(item.id, item);
			if (item.isRegularItem()) {
				for (let child of Zotero.Items.get(item.getAttachments(true))) {
					if (child.isLinkedFileAttachment()) attachmentsByID.set(child.id, child);
				}
			}
		}
		let plans = [];
		for (let attachment of attachmentsByID.values()) {
			let record = await _readSetting(
				_settingKey(MANAGED_PREFIX, attachment.libraryID, attachment.key)
			);
			if (!record) continue;
			let path = Zotero.Attachments.resolveRelativePath(record.relativePath);
			if (path) plans.push({ attachment, record, path });
		}
		return plans;
	}

	async function _recordOrphan(record, reason) {
		let key = _settingKey(ORPHAN_PREFIX, record.libraryID, record.attachmentKey);
		await _writeSetting(key, { ...record, reason, orphanedAt: _now() });
	}

	this.init = async function () {
		if (_initialized) return;
		_initialized = true;
		_observerID = Zotero.Notifier.registerObserver(this, ['item', 'file'], SETTING);
		for (let pref of [PREF_ENABLED, PREF_PROVIDER, 'baseAttachmentPath']) {
			_prefObserverIDs.push(Zotero.Prefs.registerObserver(pref, async () => {
				if (Zotero.Prefs.get(PREF_ENABLED)) {
					await this.resume();
					await this.queueLibraryMigration(Zotero.Libraries.userLibraryID);
				}
			}));
		}
		if (Zotero.Prefs.get(PREF_ENABLED)) {
			Zotero.Prefs.set('saveRelativeAttachmentPath', true);
			_startupTimer = setTimeout(() => {
				this.queueLibraryMigration(Zotero.Libraries.userLibraryID).catch(Zotero.logError);
			}, 1000);
		}
	};

	this.uninit = function () {
		if (_startupTimer) clearTimeout(_startupTimer);
		if (_observerID) Zotero.Notifier.unregisterObserver(_observerID);
		for (let id of _prefObserverIDs) Zotero.Prefs.unregisterObserver(id);
		_prefObserverIDs = [];
		_initialized = false;
	};

	this.notify = async function (event, type, ids, extraData) {
		if (type == 'item' && ['add', 'modify'].includes(event)) {
			if (!Zotero.Prefs.get(PREF_ENABLED)) return;
			for (let id of ids) {
				if (extraData?.[id]?.linkedFolderAttachmentManager) continue;
				this.queueAttachment(id, `notifier-${event}`).catch(Zotero.logError);
			}
		}
		else if (type == 'file' && ['download', 'modify'].includes(event)) {
			if (!Zotero.Prefs.get(PREF_ENABLED)) return;
			for (let id of ids) this.queueAttachment(id, `notifier-file-${event}`).catch(Zotero.logError);
		}
		else if (type == 'item' && event == 'delete') {
			for (let id of ids) {
				if (extraData?.[id]?.linkedFolderAttachmentManager) continue;
				let libraryID = extraData?.[id]?.libraryID;
				let key = extraData?.[id]?.key;
				if (!libraryID || !key) continue;
				let record = await _readSetting(_settingKey(MANAGED_PREFIX, libraryID, key));
				if (record) await _recordOrphan(record, 'noninteractive-item-deletion');
			}
		}
	};

	this.queueAttachment = function (itemID, reason = 'manual') {
		let previous = _queues.get(itemID) || Promise.resolve();
		let next = previous.then(() => _processJob(itemID, reason));
		_queues.set(itemID, next);
		next.finally(() => {
			if (_queues.get(itemID) == next) _queues.delete(itemID);
		});
		return next;
	};

	this.queueLibraryMigration = async function (libraryID = Zotero.Libraries.userLibraryID) {
		if (libraryID != Zotero.Libraries.userLibraryID || _paused || !Zotero.Prefs.get(PREF_ENABLED)) {
			return [];
		}
		let ids = await Zotero.DB.columnQueryAsync(
			'SELECT IA.itemID FROM itemAttachments IA '
				+ 'JOIN items I ON I.itemID=IA.itemID '
				+ 'JOIN items P ON P.itemID=IA.parentItemID '
				+ 'WHERE I.libraryID=? AND IA.linkMode IN (?, ?) '
				+ 'AND (LOWER(IA.contentType) IN (' + [...PDF_CONTENT_TYPES].map(() => '?').join(',') + ') '
				+ "OR LOWER(IA.path) LIKE '%.pdf') AND I.itemID NOT IN (SELECT itemID FROM deletedItems) '",
			[
				libraryID,
				Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
				Zotero.Attachments.LINK_MODE_IMPORTED_URL,
				...PDF_CONTENT_TYPES,
			]
		);
		let queued = [];
		for (let id of ids) queued.push(this.queueAttachment(id, 'library-scan'));
		let rows = await _getRows(JOB_PREFIX);
		for (let row of rows) {
			let job;
			try {
				job = JSON.parse(row.value);
			}
			catch {
				continue;
			}
			if (job.libraryID == libraryID && !FINAL_PHASES.has(job.phase)) {
				queued.push(_resumeJob.call(this, job, 'resume-scan'));
			}
		}
		return Promise.allSettled(queued);
	};

	this.getOrCreateArticleFolder = async function (parentItemID) {
		let parent = await Zotero.Items.getAsync(parentItemID);
		if (!parent?.isRegularItem() || parent.itemType != 'journalArticle') {
			throw new Error('A journal article item is required');
		}
		let root = _getRoot();
		let validation = root && await _getProvider(root).validateRoot(root);
		if (!validation?.valid) throw new Error(`Linked folder is unavailable: ${validation?.code || 'missing-root'}`);
		return _chooseArticleFolder(parent);
	};

	this.previewMigration = async function (libraryID = Zotero.Libraries.userLibraryID) {
		let ids = await Zotero.DB.columnQueryAsync(
			'SELECT IA.itemID FROM itemAttachments IA JOIN items I USING (itemID) '
				+ 'WHERE I.libraryID=? AND IA.parentItemID IS NOT NULL AND IA.linkMode IN (?, ?) '
				+ "AND (LOWER(IA.contentType)='application/pdf' OR LOWER(IA.path) LIKE '%.pdf') "
				+ 'AND I.itemID NOT IN (SELECT itemID FROM deletedItems)',
			[libraryID, Zotero.Attachments.LINK_MODE_IMPORTED_FILE, Zotero.Attachments.LINK_MODE_IMPORTED_URL]
		);
		let count = 0;
		let bytes = 0;
		for (let id of ids) {
			let item = await Zotero.Items.getAsync(id);
			if (!await _eligibleItem(item)) continue;
			count++;
			let path = await item.getFilePathAsync();
			if (path) {
				try {
					bytes += (await IOUtils.stat(path)).size;
				}
				catch {
					// Missing remote file is still part of the preview.
				}
			}
		}
		return { libraryID, count, bytes };
	};

	this.getMigrationStatus = async function (libraryID = Zotero.Libraries.userLibraryID) {
		let rows = await _getRows(JOB_PREFIX);
		let jobs = [];
		for (let row of rows) {
			try {
				let job = JSON.parse(row.value);
				if (job.libraryID == libraryID) jobs.push(job);
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		let counts = {};
		for (let job of jobs) counts[job.phase] = (counts[job.phase] || 0) + 1;
		return {
			libraryID,
			paused: _paused,
			active: _queues.size,
			total: jobs.length,
			complete: counts.complete || 0,
			failed: jobs.filter(job => job.lastError && !WAITING_PHASES.has(job.phase)).length,
			waiting: jobs.filter(job => WAITING_PHASES.has(job.phase)).length,
			counts,
			jobs,
		};
	};

	this.pause = async function () {
		_paused = true;
		return this.getMigrationStatus();
	};

	this.resume = async function (libraryID = Zotero.Libraries.userLibraryID) {
		_paused = false;
		return this.queueLibraryMigration(libraryID);
	};

	this.retryFailed = async function (libraryID = Zotero.Libraries.userLibraryID) {
		let rows = await _getRows(JOB_PREFIX);
		let retried = [];
		for (let row of rows) {
			let job;
			try {
				job = JSON.parse(row.value);
			}
			catch {
				continue;
			}
			if (job.libraryID != libraryID || job.phase == 'complete' || job.phase == 'conflict') continue;
			job.lastError = null;
			await _saveJob(job);
			retried.push(_resumeJob.call(this, job, 'retry'));
		}
		return Promise.allSettled(retried);
	};

	/**
	 * Prepare a recoverable deletion plan. This never deletes data and never
	 * runs for a normal move to Zotero Trash. Call completeManagedFileDeletion
	 * only after the Zotero database deletion succeeds.
	 */
	this.prepareManagedFileDeletion = async function (itemIDs, { interactive = false } = {}) {
		let loaded = await Zotero.Items.getAsync(itemIDs);
		let items = (Array.isArray(loaded) ? loaded : [loaded]).filter(Boolean);
		let entries = await _collectManagedItems(items);
		if (!entries.length) return { approved: true, entries: [] };
		let approved = true;
		if (interactive) {
			approved = Services.prompt.confirm(
				null,
				'Linked Cloud Folder',
				`Move ${entries.length} managed linked file${entries.length == 1 ? '' : 's'} to the macOS Trash after deleting the Zotero item${entries.length == 1 ? '' : 's'}?`
			);
		}
		return { approved, entries: approved ? entries.map(({ record, path }) => ({ record, path })) : [] };
	};

	this.completeManagedFileDeletion = async function (plan) {
		if (!plan?.approved) return { moved: 0, orphaned: 0 };
		let moved = 0;
		let orphaned = 0;
		for (let entry of plan.entries) {
			try {
				let provider = _getProvider(_getRoot());
				if (!provider.moveToTrash) throw new Error('Provider does not support moving files to Trash');
				if (await provider.moveToTrash(entry.path)) moved++;
				let folder = PathUtils.parent(entry.path);
				if (folder != _getRoot() && await IOUtils.exists(folder)) {
					let children = await IOUtils.getChildren(folder);
					if (!children.length) await IOUtils.remove(folder);
				}
				await _deleteSetting(_settingKey(
					MANAGED_PREFIX,
					entry.record.libraryID,
					entry.record.attachmentKey
				));
				await _deleteSetting(_settingKey(
					ORPHAN_PREFIX,
					entry.record.libraryID,
					entry.record.attachmentKey
				));
			}
			catch (e) {
				Zotero.logError(e);
				orphaned++;
				await _recordOrphan(entry.record, e.message || 'managed-file-delete-failed');
			}
		}
		return { moved, orphaned };
	};

	// Small public helpers keep naming and verification independently testable.
	this.sanitizeArticleFolderName = _sanitizeFolderName;
	this.sanitizeFilename = _sanitizeFilename;
	this.sha256File = _sha256File;
	this.isEligibleAttachment = _eligibleItem;
	this.convertStoredFileToLinkedFile = async function (itemID, reason = 'manual-conversion') {
		return this.queueAttachment(itemID, reason);
	};
};
