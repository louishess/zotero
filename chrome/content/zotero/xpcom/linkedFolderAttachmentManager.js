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
	const OWNER_FILENAME = '.zotero-linked-folder-owner.json';
	const ROOT_MARKER_FILENAME = '.zotero-linked-folder-root.json';
	const INSTALLATION_KEY = 'installation';
	const FORMAT = 'bibliography=http://www.zotero.org/styles/american-chemical-society';
	const MAX_FOLDER_CODE_POINTS = 100;
	const MAX_NAME_BYTES = 240;
	const PDF_CONTENT_TYPES = new Set([
		'application/pdf',
		'application/x-pdf',
		'application/acrobat',
		'applications/vnd.pdf',
		'text/pdf',
		'text/x-pdf',
	]);
	const WAITING_PHASES = new Set([
		'waiting-source',
		'waiting-reader',
		'waiting-root',
		'waiting-organizer',
		'waiting-annotation-lock',
		'waiting-fulltext-reindex',
	]);
	const FINAL_PHASES = new Set(['complete', 'conflict']);

	let _initialized = false;
	let _paused = false;
	let _observerID;
	let _prefObserverIDs = [];
	let _queues = new Map();
	let _startupTimer;
	let _managerOwnedErasures = new Set();

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
		return _normalizePath(path);
	}

	function _normalizePath(path) {
		if (typeof path != 'string' || !path.trim()) return null;
		let value = path.trim().replace(/\\/gu, '/');
		let absolute = value.startsWith('/') || /^[A-Za-z]:\//u.test(value);
		let drive = /^[A-Za-z]:/u.test(value) ? value.slice(0, 2) : '';
		let parts = value.slice(drive.length).split('/');
		let normalized = [];
		for (let part of parts) {
			if (!part || part == '.') continue;
			if (part == '..' && normalized.length
					&& normalized[normalized.length - 1] != '..') {
				normalized.pop();
			}
			else if (part != '..') normalized.push(part);
		}
		let result = normalized.join('/');
		if (drive) return `${drive}/${result}`;
		return absolute ? `/${result}` : result || '.';
	}

	function _pathIsSymlink(path) {
		try {
			return !!Zotero.File.pathToFile(path).isSymlink();
		}
		catch {
			return false;
		}
	}

	// Check only the configured root and its descendants. System paths such as
	// /var on macOS may themselves be symlinks and are safe ancestors.
	function _containsSymlink(root, path) {
		root = _normalizePath(root);
		path = _normalizePath(path);
		if (!root || !path || !Zotero.File.directoryContains(root, path)) return true;
		let current = path;
		while (current && current != root) {
			if (_pathIsSymlink(current)) return true;
			let parent = PathUtils.parent(current);
			if (!parent || parent == current) break;
			current = parent;
		}
		return _pathIsSymlink(root);
	}

	function _utf8Length(value) {
		return new TextEncoder().encode(value).length;
	}

	function _truncateUtf8(value, maxBytes) {
		let result = '';
		for (let character of value) {
			let next = result + character;
			if (_utf8Length(next) > maxBytes) break;
			result = next;
		}
		return result;
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

	function _leafName(value) {
		value = String(value || '').replace(/\\/gu, '/');
		return value.slice(value.lastIndexOf('/') + 1);
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
		value = _truncateCodePoints(value, maxCodePoints);
		value = _truncateUtf8(value, MAX_NAME_BYTES).replace(/[ .]+$/gu, '');
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

	function _folderCandidate(base, index) {
		let suffix = index == 1 ? '' : ` (${index})`;
		let codePoints = Math.max(1, MAX_FOLDER_CODE_POINTS - Array.from(suffix).length);
		let bytes = Math.max(1, MAX_NAME_BYTES - _utf8Length(suffix));
		let safeBase = _truncateUtf8(_truncateCodePoints(base, codePoints), bytes)
			.replace(/[ .]+$/gu, '') || 'Untitled Article';
		return `${safeBase}${suffix}`;
	}

	function _extension(value, contentType) {
		let filename = _leafName(value);
		let match = filename.match(/(\.[^./\\\s]+)$/u);
		if (match) return match[1];
		try {
			let extension = contentType && Zotero.MIME.getPrimaryExtension(contentType);
			if (extension) return `.${extension}`;
		}
		catch (e) {
			Zotero.logError(e);
		}
		return '.pdf';
	}

	function _relationSignature(relations) {
		return JSON.stringify(Object.entries(relations || {})
			.map(([predicate, values]) => [
				predicate,
				(Array.isArray(values) ? values : [values]).map(String).sort(),
			])
			.sort(([a], [b]) => a.localeCompare(b)));
	}

	function _stableValue(value) {
		if (Array.isArray(value)) {
			return value.map(_stableValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		}
		if (value && typeof value == 'object') {
			return Object.fromEntries(Object.entries(value)
				.filter(([key]) => !['key',
					'version',
					'mtime',
					'md5',
					'path',
					'linkMode',
					'filename',
					'dateModified'].includes(key))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, _stableValue(entry)]));
		}
		return value;
	}

	function _attachmentMetadataSignature(item) {
		return JSON.stringify(_stableValue(item.toJSON({ skipStorageProperties: true })));
	}

	async function _childIDs(attachmentID) {
		return Zotero.DB.columnQueryAsync(
			'SELECT itemID FROM itemAnnotations WHERE parentItemID=? '
				+ 'UNION SELECT itemID FROM itemNotes WHERE parentItemID=? '
				+ 'UNION SELECT itemID FROM itemAttachments WHERE parentItemID=?',
			[attachmentID, attachmentID, attachmentID]
		);
	}

	function _sanitizeFilename(value, contentType) {
		let extension = _extension(value, contentType);
		let filename = _leafName(value || 'attachment');
		if (filename.toLowerCase().endsWith(extension.toLowerCase())) {
			filename = filename.slice(0, -extension.length);
		}
		let fallback = `attachment${extension}`;
		let base = _sanitizeName(filename, { fallback, maxCodePoints: 180 });
		// The extension is preserved verbatim apart from path separators and
		// control characters. Unknown formats therefore remain unknown formats.
		extension = _sanitizeName(extension, { fallback: '.pdf', maxCodePoints: 32 });
		if (!extension.startsWith('.')) extension = `.${extension}`;
		let available = Math.max(1, MAX_NAME_BYTES - _utf8Length(extension));
		base = _truncateUtf8(_truncateCodePoints(base, 180), available)
			.replace(/[ .]+$/gu, '') || 'attachment';
		return `${base}${extension}`;
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

	async function _verifiedFileIdentity(path, fileToken = null) {
		let before = await IOUtils.stat(path);
		if (fileToken && (fileToken.size === undefined || fileToken.lastModified === undefined
				|| before.size != fileToken.size || before.lastModified != fileToken.lastModified)) {
			throw new Error('The managed linked-file worker token does not match the current file');
		}
		let sha256 = await _sha256File(path);
		let after = await IOUtils.stat(path);
		if (before.size != after.size || before.lastModified != after.lastModified) {
			throw new Error('The managed linked file changed during post-write verification');
		}
		if (fileToken && (after.size != fileToken.size || after.lastModified != fileToken.lastModified)) {
			throw new Error('The managed linked-file worker token changed during verification');
		}
		return { size: after.size, sha256 };
	}

	function _sameIdentity(a, b) {
		return !!a && !!b && a.size == b.size && a.sha256 == b.sha256;
	}

	function _canContinue() {
		return !_paused && Zotero.Prefs.get(PREF_ENABLED);
	}

	async function _getInstallationID() {
		let stored = await _readSetting(INSTALLATION_KEY);
		if (stored?.instanceID) return stored.instanceID;
		let instanceID = Zotero.Utilities.randomString(24);
		await _writeSetting(INSTALLATION_KEY, { v: 1, instanceID });
		return instanceID;
	}

	async function _readOwnerClaim(path) {
		try {
			return await IOUtils.readJSON(path);
		}
		catch (e) {
			if (e.name == 'NotFoundError') return null;
			throw e;
		}
	}

	async function _readRootMarker(root) {
		let path = PathUtils.join(root, ROOT_MARKER_FILENAME);
		if (_pathIsSymlink(path)) throw new Error('The linked-folder root marker is a symlink');
		try {
			let marker = await IOUtils.readJSON(path);
			if (marker?.v != 1 || typeof marker.generation != 'string'
					|| !marker.generation) {
				throw new Error('The linked-folder root marker is invalid');
			}
			let { lastModified } = await IOUtils.stat(path);
			return { ...marker, lastModified };
		}
		catch (e) {
			if (e.name == 'NotFoundError') return null;
			throw e;
		}
	}

	async function _ensureRootMarker(root) {
		let path = PathUtils.join(root, ROOT_MARKER_FILENAME);
		let current = await _readRootMarker(root);
		if (current) return current;
		let marker = {
			v: 1,
			generation: Zotero.Utilities.randomString(24),
			createdAt: _now(),
		};
		let tempPath = `${path}.tmp-${marker.generation}`;
		await IOUtils.writeJSON(tempPath, marker);
		try {
			await IOUtils.move(tempPath, path, { noOverwrite: true });
		}
		catch (e) {
			await IOUtils.remove(tempPath, { ignoreAbsent: true });
			current = await _readRootMarker(root);
			if (!current) throw e;
			return current;
		}
		return _readRootMarker(root);
	}

	async function _findRootArtifactConflicts(root, { instanceID, rootGeneration } = {}) {
		instanceID ||= await _getInstallationID();
		let allowed = new Set([
			OWNER_FILENAME,
			ROOT_MARKER_FILENAME,
			`${OWNER_FILENAME}.tmp-${instanceID}`,
		]);
		if (rootGeneration) allowed.add(`${ROOT_MARKER_FILENAME}.tmp-${rootGeneration}`);
		let reservedPrefixes = [OWNER_FILENAME, ROOT_MARKER_FILENAME].map(
			filename => filename.replace(/\.json$/iu, '').toLocaleLowerCase()
		);
		let conflicts = [];
		for (let child of await IOUtils.getChildren(root)) {
			let name = _leafName(child);
			if (allowed.has(name)) continue;
			let lowerName = name.toLocaleLowerCase();
			if (reservedPrefixes.some(prefix => lowerName.startsWith(prefix))) {
				conflicts.push(name);
			}
		}
		return conflicts.sort();
	}

	function _artifactConflictError(conflicts) {
		return `Conflicting linked-folder organizer artifacts: ${conflicts.join(', ')}`;
	}

	async function _rootIdentity(root) {
		await IOUtils.stat(root);
		// IOUtils.stat does not expose a portable inode/device identity in Gecko.
		// The explicit root marker and organizer generation provide the supported
		// replacement evidence; this value intentionally contains only the
		// lexical configured path.
		return { path: _normalizePath(root) };
	}

	function _sameRoot(a, b) {
		if (!a || !b || _normalizePath(a.path || '') != _normalizePath(b.path || '')) {
			return false;
		}
		return (a.device === undefined || b.device === undefined || a.device == b.device)
			&& (a.inode === undefined || b.inode === undefined || a.inode == b.inode);
	}

	async function _assertJobRoot(job, root) {
		if (!root || (job.rootPath && _normalizePath(job.rootPath) != _normalizePath(root))) {
			throw new Error('The linked-folder root changed during migration');
		}
		if (_containsSymlink(root, root)) throw new Error('The linked-folder root is a symlink');
		let identity = await _rootIdentity(root);
		if (job.rootIdentity && !_sameRoot(job.rootIdentity, identity)) {
			throw new Error('The linked-folder root identity changed during migration');
		}
		return identity;
	}

	async function _validateConfiguredRoot() {
		let root = _getRoot();
		let provider = root && _getProvider(root);
		let validation = provider && await provider.validateRoot(root);
		if (!validation?.valid) {
			return { root, provider, validation };
		}
		if (_containsSymlink(root, root)) {
			return {
				root,
				provider,
				validation: { valid: false, code: 'symlink-root', path: root },
			};
		}
		return { root, provider, validation, identity: await _rootIdentity(root) };
	}

	async function _getClaimStatus() {
		let { root, identity } = await _validateConfiguredRoot();
		let ownerPath = root && PathUtils.join(root, OWNER_FILENAME);
		let ownerSymlink = !!ownerPath && _pathIsSymlink(ownerPath);
		let claimReadError = false;
		let claim = null;
		if (root && !ownerSymlink) {
			try {
				claim = await _readOwnerClaim(ownerPath);
			}
			catch (e) {
				Zotero.logError(e);
				claimReadError = true;
			}
		}
		let marker = null;
		let conflictingArtifacts = [];
		if (root && identity) {
			try {
				marker = await _readRootMarker(root);
			}
			catch (e) {
				Zotero.logError(e);
			}
			if (ownerSymlink) conflictingArtifacts.push(OWNER_FILENAME);
			if (claimReadError) conflictingArtifacts.push(OWNER_FILENAME);
		}
		let ownerID = Zotero.Users.getLocalUserKey();
		let instanceID = await _getInstallationID();
		if (root && identity) {
			try {
				conflictingArtifacts.push(...await _findRootArtifactConflicts(root, {
					instanceID,
					rootGeneration: marker?.generation,
				}));
			}
			catch (e) {
				// A root that cannot be enumerated cannot be safely claimed or used
				// for destructive work. Surface that as a conflict for the UI.
				Zotero.logError(e);
				conflictingArtifacts = ['<root-unreadable>'];
			}
		}
		let valid = claim?.v == 1 && typeof claim.ownerID == 'string'
			&& typeof claim.instanceID == 'string' && typeof claim.generation == 'string'
			&& typeof claim.rootGeneration == 'string' && !!marker
			&& claim.rootGeneration == marker.generation
			&& claim.rootMarkerModified === marker.lastModified
			&& !!identity && !!claim.root && _sameRoot(claim.root, identity);
		let isOrganizer = !!(valid && claim.ownerID == ownerID
			&& claim.instanceID == instanceID
			&& _sameRoot(claim.root, identity));
		let state = !claim
			? 'unclaimed'
			: !valid
				? claim.ownerID == ownerID && claim.instanceID == instanceID
					? 'root-mismatch'
					: typeof claim.ownerID == 'string' ? 'foreign' : 'invalid'
				: isOrganizer
					? 'owned'
					: claim.ownerID == ownerID && claim.instanceID == instanceID ? 'root-mismatch' : 'foreign';
		if (conflictingArtifacts.length) {
			state = 'conflict';
			isOrganizer = false;
		}
		return {
			isOrganizer,
			ownerID: typeof claim?.ownerID == 'string' ? claim.ownerID : null,
			instanceID: typeof claim?.instanceID == 'string' ? claim.instanceID : instanceID,
			generation: typeof claim?.generation == 'string' ? claim.generation : null,
			state,
			rootPath: claim?.root?.path || null,
			conflictingArtifacts,
		};
	}

	async function _ensureMigrationOwner(job, root) {
		let ownerID = Zotero.Users.getLocalUserKey();
		let instanceID = await _getInstallationID();
		let ownerPath = PathUtils.join(root, OWNER_FILENAME);
		if (_pathIsSymlink(ownerPath)) {
			await _setPhase(job, 'conflict', {
				lastError: 'The organizer claim is a symlink',
				conflictingArtifacts: [OWNER_FILENAME],
			});
			return false;
		}
		let claim;
		try {
			claim = await _readOwnerClaim(ownerPath);
		}
		catch (e) {
			await _setPhase(job, 'conflict', {
				lastError: `The organizer claim is unreadable: ${e.message || e}`,
				conflictingArtifacts: [OWNER_FILENAME],
			});
			return false;
		}
		let identity = await _rootIdentity(root);
		let marker;
		try {
			marker = await _readRootMarker(root);
		}
		catch (e) {
			await _setWaiting(job, 'organizer-root-mismatch', {
				lastError: e.message || 'The linked-folder root marker is unavailable',
			});
			return false;
		}
		let conflictingArtifacts;
		try {
			conflictingArtifacts = await _findRootArtifactConflicts(root, {
				instanceID,
				rootGeneration: marker?.generation,
			});
		}
		catch (e) {
			await _setPhase(job, 'conflict', {
				lastError: `The linked-folder root could not be checked: ${e.message || e}`,
			});
			return false;
		}
		if (conflictingArtifacts.length) {
			await _setPhase(job, 'conflict', {
				lastError: _artifactConflictError(conflictingArtifacts),
				conflictingArtifacts,
			});
			return false;
		}

		let claimOwnerID = typeof claim?.ownerID == 'string' ? claim.ownerID : null;
		let claimInstanceID = typeof claim?.instanceID == 'string' ? claim.instanceID : null;
		let validClaim = claim?.v == 1 && !!claimOwnerID && !!claimInstanceID
			&& typeof claim.generation == 'string' && typeof claim.rootGeneration == 'string'
			&& !!marker && claim.rootGeneration == marker.generation
			&& claim.rootMarkerModified === marker.lastModified && !!claim.root
			&& _sameRoot(claim.root, identity);
		let ownsClaim = validClaim && claim.ownerID == ownerID && claim.instanceID == instanceID
			&& _sameRoot(claim.root, identity);
		let matchesJob = !job.ownerID
			|| (job.ownerID == claim.ownerID && job.ownerInstanceID == claim.instanceID
				&& job.ownerGeneration == claim.generation
				&& (!job.rootGeneration || job.rootGeneration == claim.rootGeneration));
		if (!ownsClaim || !matchesJob) {
			await _setWaiting(job, claim?.ownerID == ownerID ? 'organizer-root-mismatch' : 'organizer-required', {
				lastError: claim ? 'Another Zotero installation owns linked-folder migration' : 'This installation is not the linked-folder organizer',
				conflictingOwnerID: claimOwnerID,
				conflictingOwnerInstanceID: claimInstanceID,
				conflictingOwnerGeneration: typeof claim?.generation == 'string' ? claim.generation : null,
			});
			return false;
		}
		if (!job.ownerID) {
			Object.assign(job, {
				ownerID: claim.ownerID,
				ownerInstanceID: claim.instanceID,
				ownerGeneration: claim.generation,
				rootGeneration: claim.rootGeneration,
				rootPath: identity.path,
				rootIdentity: identity,
			});
			await _saveJob(job);
		}
		else if (!job.rootGeneration) {
			job.rootGeneration = claim.rootGeneration;
			await _saveJob(job);
		}
		return true;
	}

	async function _verifyCurrentSource(job, sourcePath) {
		let expected = {
			size: job.sourceSize,
			sha256: job.sourceSHA256,
		};
		let current;
		try {
			current = await _fileIdentity(sourcePath);
		}
		catch {
			await _setPhase(job, 'conflict', {
				lastError: 'The stored source file became unavailable during migration',
			});
			return false;
		}
		if (!_sameIdentity(current, expected)) {
			await _setPhase(job, 'conflict', {
				lastError: 'The stored source file changed during migration',
				currentSourceSize: current.size,
				currentSourceSHA256: current.sha256,
			});
			return false;
		}
		return true;
	}

	async function _eligibleItem(item) {
		if (!item || item.deleted || item.libraryID != Zotero.Libraries.userLibraryID
				|| !item.isAttachment() || !item.isStoredFileAttachment()
				|| item.isEmbeddedImageAttachment?.()
				|| item.attachmentLinkMode == Zotero.Attachments.LINK_MODE_LINKED_URL
				|| !item.parentItemID) {
			return false;
		}
		let parent = item.parentItem;
		if (!parent || parent.deleted || parent.itemType != 'journalArticle') return false;
		// A snapshot is a directory, even though its index.html looks like a
		// single file. Multi-file HTML captures and embedded images stay in
		// Zotero's managed storage.
		if (item.isSnapshotAttachment?.()) return false;
		let contentType = (item.attachmentContentType || '').toLowerCase().split(';', 1)[0];
		let hasSingleFileIdentity = !!item.attachmentFilename || !!contentType;
		if (contentType == 'text/html') return false;
		let linkMode = item.attachmentLinkMode;
		let path = await item.getFilePathAsync();
		if (!path) {
			// Imported files can be temporarily unavailable while their storage is
			// being downloaded. An imported URL needs a filename/content type to
			// distinguish a downloaded file from a URL-only attachment.
			return linkMode == Zotero.Attachments.LINK_MODE_IMPORTED_FILE
				|| (linkMode == Zotero.Attachments.LINK_MODE_IMPORTED_URL && hasSingleFileIdentity);
		}
		try {
			let stat = await IOUtils.stat(path);
			if (stat.type != 'regular') return false;
		}
		catch {
			// Let the download controller or a manual recovery attempt handle a
			// missing/inaccessible stored path. No bytes are touched here.
			return linkMode == Zotero.Attachments.LINK_MODE_IMPORTED_FILE
				|| (linkMode == Zotero.Attachments.LINK_MODE_IMPORTED_URL && hasSingleFileIdentity);
		}
		return true;
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
		let rootIdentity;
		try {
			rootIdentity = await _rootIdentity(root);
		}
		catch {
			return null;
		}
		let foundFolder = null;
		for (let attachment of Zotero.Items.get(parent.getAttachments(false))) {
			if (!attachment.isLinkedFileAttachment()) continue;
			let relative = attachment.attachmentPath;
			if (!relative?.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) continue;
			let absolute = Zotero.Attachments.resolveRelativePath(relative);
			if (!absolute || !Zotero.File.directoryContains(root, absolute)
					|| _containsSymlink(root, absolute)) continue;
			let record = await _readSetting(
				_settingKey(MANAGED_PREFIX, attachment.libraryID, attachment.key)
			);
			if (!record) continue;
			if (record.parentKey != parent.key) {
				throw new Error('A managed linked attachment has a conflicting article parent');
			}
			if (record.relativePath != relative
					|| (record.rootPath && _normalizePath(record.rootPath) != root)
					|| (record.rootIdentity && !_sameRoot(record.rootIdentity, rootIdentity))) continue;
			let folder = PathUtils.parent(absolute);
			if (folder == root) continue;
			if (foundFolder && foundFolder != folder) {
				throw new Error('Managed linked attachments for this article use conflicting folders');
			}
			foundFolder = folder;
		}
		return foundFolder;
	}

	function _relativeToRoot(root, path) {
		root = _normalizePath(root).replace(/\\/g, '/').replace(/\/$/u, '');
		path = _normalizePath(path).replace(/\\/g, '/');
		if (!path.startsWith(`${root}/`)) {
			throw new Error('Path is outside the linked attachment base directory');
		}
		if (_containsSymlink(root, path)) throw new Error('Path contains a symlink');
		return path.slice(root.length + 1);
	}

	async function _chooseArticleFolder(parent) {
		let mappingKey = _settingKey(FOLDER_PREFIX, parent.libraryID, parent.key);
		let root = _getRoot();
		let rootIdentity = await _rootIdentity(root);
		let reused = await _folderForLinkedChild(parent);
		let stored = await _readSetting(mappingKey);
		if (stored?.relativePath) {
			if (stored.rootPath && _normalizePath(stored.rootPath) != root) {
				throw new Error('The article folder is mapped to a different linked-folder root');
			}
			if (stored.rootIdentity && !_sameRoot(stored.rootIdentity, rootIdentity)) {
				throw new Error('The article folder root identity changed');
			}
			if (PathUtils.isAbsolute(stored.relativePath)
					|| stored.relativePath.split(/[\\/]/u).includes('..')) {
				throw new Error('The article folder mapping is unsafe');
			}
			let folder = PathUtils.joinRelative(root, stored.relativePath);
			if (_containsSymlink(root, folder)) {
				throw new Error('The article folder contains a symlink');
			}
			if (reused && reused != folder) {
				throw new Error('The article folder mapping conflicts with an existing linked attachment');
			}
			await Zotero.File.createDirectoryIfMissingAsync(folder, { createAncestors: true });
			return folder;
		}

		if (reused) {
			let relativePath = _relativeToRoot(root, reused);
			await _writeSetting(mappingKey, {
				v: 2, relativePath, rootPath: root, rootIdentity,
			});
			return reused;
		}

		let base = await _citationFolderName(parent);
		let name = _folderCandidate(base, 1);
		for (let index = 2; await IOUtils.exists(PathUtils.join(root, name)); index++) {
			name = _folderCandidate(base, index);
		}
		let folder = PathUtils.join(root, name);
		await Zotero.File.createDirectoryIfMissingAsync(folder, { createAncestors: true });
		if (_containsSymlink(root, folder)) throw new Error('The article folder contains a symlink');
		await _writeSetting(mappingKey, {
			v: 2, relativePath: name, rootPath: root, rootIdentity,
		});
		return folder;
	}

	async function _chooseTarget(folder, filename) {
		let parsed = _leafName(filename);
		let extension = _extension(parsed);
		let base = parsed.slice(0, parsed.length - extension.length) || 'attachment';
		for (let index = 1; ; index++) {
			let suffix = index == 1 ? '' : ` (${index})`;
			let available = Math.max(1, MAX_NAME_BYTES - _utf8Length(`${suffix}${extension}`));
			let safeBase = _truncateUtf8(base, available).replace(/[ .]+$/gu, '') || 'attachment';
			let candidate = PathUtils.join(folder, `${safeBase}${suffix}${extension}`);
			if (!(await IOUtils.exists(candidate))) return { path: candidate, reuse: false };
		}
	}

	async function _saveJob(job) {
		return _writeSetting(_settingKey(JOB_PREFIX, job.libraryID, job.sourceKey), job);
	}

	function _legacyWaitReason(phase) {
		return {
			'waiting-source': 'source-unavailable',
			'waiting-reader': 'reader-open',
			'waiting-root': 'root-unavailable',
		}[phase] || null;
	}

	async function _normalizeJob(job) {
		if (!job) return job;
		if (job.progressVersion === null || job.progressVersion === undefined) job.progressVersion = 1;
		if (job.v < 2) {
			let waitReason = job.waitReason || _legacyWaitReason(job.phase);
			if (waitReason) {
				job.waitReason = waitReason;
				job.status = 'waiting';
				job.phase = job.progressPhase || 'queued';
			}
			job.v = 2;
		}
		if (!job.progressPhase) job.progressPhase = job.phase || 'queued';
		if (!job.status) job.status = job.waitReason ? 'waiting' : 'running';
		return job;
	}

	async function _loadOrCreateJob(item, reason) {
		let key = _settingKey(JOB_PREFIX, item.libraryID, item.key);
		let job = await _readSetting(key);
		if (!job) {
			job = {
				v: 2,
				progressVersion: 1,
				libraryID: item.libraryID,
				sourceKey: item.key,
				parentKey: item.parentKey,
				parentItemID: item.parentItemID,
				phase: 'queued',
				progressPhase: 'queued',
				status: 'running',
				waitReason: null,
				reason,
				attempts: 0,
			};
			await _saveJob(job);
		}
		else {
			await _normalizeJob(job);
			await _saveJob(job);
		}
		return job;
	}

	async function _setPhase(job, phase, changes = {}) {
		if (phase == 'conflict' && job.phase && job.phase != 'conflict'
				&& !job.resumePhase) {
			changes = { resumePhase: job.phase, ...changes };
		}
		Object.assign(job, changes, {
			phase,
			progressPhase: phase,
			status: FINAL_PHASES.has(phase) ? phase : 'running',
			waitReason: null,
		});
		await _saveJob(job);
	}

	async function _setWaiting(job, waitReason, changes = {}) {
		Object.assign(job, changes, {
			status: 'waiting',
			waitReason,
		});
		await _saveJob(job);
	}

	async function _ensureSource(job, source) {
		let path = source && await source.getFilePathAsync();
		if (path && await IOUtils.exists(path)) {
			if (_pathIsSymlink(path)) {
				await _setPhase(job, 'conflict', { lastError: 'The stored source file is a symlink' });
				return null;
			}
			return path;
		}

		// A user initiated conversion is allowed to recover a missing synced
		// source. Background scans wait for the independent download controller.
		if (job.reason == 'manual-conversion' || job.reason == 'force-recovery') {
			try {
				await Zotero.Sync.Runner.downloadFile(source);
				path = await source.getFilePathAsync();
				if (path && await IOUtils.exists(path) && !_pathIsSymlink(path)) return path;
			}
			catch (e) {
				Zotero.debug(e, 2);
			}
		}
		await _setWaiting(job, 'source-unavailable', { lastError: null });
		return null;
	}

	async function _copyAndVerify(job, sourcePath, { phaseAfter = 'copy-verified' } = {}) {
		let root = _getRoot();
		if (!root || !job.targetPath || !Zotero.File.directoryContains(root, job.targetPath)
				|| _containsSymlink(root, job.targetPath)) {
			throw new Error('The selected cloud destination is outside the current root');
		}
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
				let error = new Error('Destination file changed after it was selected');
				await _setPhase(job, 'conflict', { lastError: error.message });
				throw error;
			}
			await _setPhase(job, phaseAfter);
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
		try {
			await IOUtils.move(tempPath, targetPath, { noOverwrite: true });
		}
		catch (e) {
			// Another process may have completed the same atomic rename. Adopt it
			// only when the final identity is exact; never overwrite a conflict.
			if (await IOUtils.exists(targetPath)
					&& _sameIdentity(await _fileIdentity(targetPath), sourceIdentity)) {
				await IOUtils.remove(tempPath, { ignoreAbsent: true });
				await _setPhase(job, phaseAfter);
				return;
			}
			throw e;
		}
		if (!_sameIdentity(await _fileIdentity(targetPath), sourceIdentity)) {
			let error = new Error('Cloud copy failed SHA-256 verification after rename');
			await _setPhase(job, 'conflict', { lastError: error.message });
			throw error;
		}
		await _setPhase(job, phaseAfter);
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

		// A linked item at the planned path but with another key represents a
		// separate attachment or another migration generation. Never collapse it
		// merely because the bytes happen to be equal.
		let replacements = Zotero.Items.get(source.parentItem.getAttachments(false)).filter(
			item => item.isLinkedFileAttachment()
				&& item.attachmentPath == job.targetRelativePath
		);
		if (replacements.length) {
			await _setPhase(job, 'conflict', {
				lastError: 'Another attachment already refers to the planned managed cloud file',
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
		await linked.loadPrimaryData();
		linked.fromJSON(json);
		await linked.saveTx({
			notifierData: { linkedFolderAttachmentManager: true, sourceKey: source.key },
		});
		await _setPhase(job, 'linked-item-created', { linkedItemID: linked.id });
		return linked;
	}

	async function _verifyReplacementMetadata(job, source, linked) {
		if (!job.parentItemID || source.parentItemID != job.parentItemID
				|| source.parentKey != job.parentKey
				|| linked.libraryID != source.libraryID
				|| linked.parentItemID != job.parentItemID
				|| linked.parentKey != job.parentKey
				|| !linked.isLinkedFileAttachment()
				|| linked.attachmentPath != job.targetRelativePath) {
			return 'The source or linked attachment parent and path changed during migration';
		}
		let metadataSignature = _attachmentMetadataSignature(source);
		if (job.sourceMetadataSignature && job.sourceMetadataSignature != metadataSignature) {
			return 'The stored attachment metadata changed during migration';
		}
		if (job.sourceMetadataSignature
				&& _attachmentMetadataSignature(linked) != job.sourceMetadataSignature) {
			return 'The linked attachment metadata changed during migration';
		}
		if (_relationSignature(source.getRelations()) != _relationSignature(linked.getRelations())) {
			return 'The source and linked attachment relations changed during migration';
		}
		if (!Array.isArray(job.childIDs)) {
			return 'The attachment child transfer was not durably recorded';
		}
		let sourceChildren = new Set(await _childIDs(source.id));
		let linkedChildren = new Set(await _childIDs(linked.id));
		if (sourceChildren.size) return 'The source attachment still has child items';
		let expectedChildren = new Set(job.childIDs);
		for (let childID of linkedChildren) {
			if (!expectedChildren.has(childID)) {
				return 'A new or conflicting annotation appeared on the linked attachment';
			}
		}
		for (let childID of expectedChildren) {
			let child = Zotero.Items.get(childID);
			let deleted = !!await Zotero.DB.valueQueryAsync(
				'SELECT itemID FROM deletedItems WHERE itemID=?', [childID]
			);
			if (child?.deleted && deleted) continue;
			if (child && !child.deleted && child.parentItemID != linked.id) {
				return 'An attachment child no longer belongs to the linked replacement';
			}
			if (!child && !deleted) {
				return 'An attachment child disappeared during migration';
			}
			if (child?.deleted && !deleted) {
				return 'An attachment child was deleted without a durable deletion record';
			}
		}
		return null;
	}

	async function _verifyLinkedReplacementAfterSourceGone(job, linked) {
		if (!linked?.isLinkedFileAttachment()
				|| linked.parentItemID != job.parentItemID
				|| linked.parentKey != job.parentKey
				|| linked.attachmentPath != job.targetRelativePath) {
			return 'The linked replacement parent or path changed before recovery';
		}
		if (job.sourceMetadataSignature
				&& _attachmentMetadataSignature(linked) != job.sourceMetadataSignature) {
			return 'The linked replacement metadata changed before recovery';
		}
		if (job.sourceRelationSignature
				&& _relationSignature(linked.getRelations()) != job.sourceRelationSignature) {
			return 'The linked replacement relations changed before recovery';
		}
		if (!Array.isArray(job.childIDs)) {
			return 'The attachment child transfer was not durably recorded';
		}
		let expectedChildren = new Set(job.childIDs);
		let linkedChildren = new Set(await _childIDs(linked.id));
		for (let childID of linkedChildren) {
			if (!expectedChildren.has(childID)) {
				return 'A new or conflicting child appeared on the linked replacement';
			}
		}
		for (let childID of expectedChildren) {
			if (linkedChildren.has(childID)) continue;
			let deleted = await Zotero.DB.valueQueryAsync(
				'SELECT itemID FROM deletedItems WHERE itemID=?', [childID]
			);
			if (!deleted) return 'An attachment child disappeared before recovery';
		}
		return null;
	}

	async function _transferChildrenAndIndexes(job, source, linked, lockToken = null) {
		let coordinator = Zotero.AnnotationStorageCoordinator;
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
		if (!_canContinue()) return false;
		// The cloud file must be reopened and verified before any annotation state
		// is transferred or the source state is cleared. A linked item can exist
		// durably after an interrupted run, so this check is also performed on
		// every resume.
		let linkedPath = await linked.getFilePathAsync();
		let linkedIdentity;
		try {
			if (linkedPath && !_containsSymlink(_getRoot(), linkedPath)) {
				linkedIdentity = await _fileIdentity(linkedPath);
			}
		}
		catch {
			linkedIdentity = null;
		}
		if (!linkedPath || !_sameIdentity(linkedIdentity, {
			size: job.sourceSize, sha256: job.sourceSHA256,
		})) {
			await _setPhase(job, 'conflict', {
				lastError: 'The managed cloud file is missing, changed, or reached through a symlink',
			});
			return false;
		}
		if (job.phase == 'linked-item-created') {
			if (!Array.isArray(job.childIDs)) {
				job.childIDs = await _childIDs(source.id);
				await _saveJob(job);
			}
			await Zotero.DB.executeTransaction(async () => {
				await Zotero.Items.moveChildItems(source, linked);
			});
			await Zotero.Relations.copyObjectSubjectRelations(source, linked);
			let relationshipError = await _verifyReplacementMetadata(job, source, linked);
			if (relationshipError) {
				await _setPhase(job, 'conflict', { lastError: relationshipError });
				return false;
			}
			if (_isPDF(source)) {
				if (!coordinator?.transferState || !coordinator.clearLocalState || !lockToken) {
					throw new Error('PDF annotation migration capability is unavailable');
				}
				if (!job.annotationStateTransferred) {
					let transfer = await coordinator.transferState(source.id, linked.id, {
						job, phase: 'children-transferred', lockToken,
					});
					if (transfer === false || transfer?.verified === false
							|| transfer?.transferred === false) {
						throw new Error('PDF annotation state transfer was not verified');
					}
					// Record the transfer milestone before clearing the old row. If the
					// process stops between these operations, the retry only repeats the
					// idempotent clear and never copies state a second time.
					job.annotationStateTransferred = true;
					await _saveJob(job);
				}
				await coordinator.clearLocalState(source.id, lockToken);
			}
			try {
				await Zotero.DB.executeTransaction(async () => {
					await Zotero.Fulltext.transferItemIndex(source, linked);
				});
				// transferItemIndex historically catches cache move errors internally
				// and returns no verification result. Always reindex the reopened target
				// before source erasure, so a failed cache move cannot be forgotten.
				job.fulltextDisposition = 'reindex-required';
			}
			catch (e) {
				Zotero.logError(e);
				job.fulltextDisposition = 'reindex-required';
			}
			await _setPhase(job, 'children-transferred');
		}

		linkedPath = await linked.getFilePathAsync();
		try {
			if (!linkedPath || _containsSymlink(_getRoot(), linkedPath)
					|| !_sameIdentity(await _fileIdentity(linkedPath), {
						size: job.sourceSize, sha256: job.sourceSHA256,
					})) {
				throw new Error('The new relative linked attachment could not be reopened and verified');
			}
		}
		catch (e) {
			if (job.phase != 'conflict') {
				await _setPhase(job, 'conflict', {
					lastError: e.message || 'The new relative linked attachment could not be reopened and verified',
				});
			}
			return false;
		}
		if (['reindex-required', 'reindex-pending'].includes(job.fulltextDisposition)) {
			try {
				if (!Zotero.Fulltext.indexItems) throw new Error('Full-text indexing is unavailable');
				await Zotero.Fulltext.indexItems([linked.id], { ignoreErrors: false });
				job.fulltextDisposition = 'reindexed';
			}
			catch (e) {
				Zotero.logError(e);
				job.fulltextDisposition = 'reindex-pending';
				await _setWaiting(job, 'fulltext-reindex', { lastError: e.message || String(e) });
				return false;
			}
			await _saveJob(job);
		}
		if (_isPDF(source) && !job.annotationStateTransferred) {
			await _setWaiting(job, 'annotation-transfer', {
				lastError: 'PDF annotation state transfer was not durably recorded',
			});
			return false;
		}
		let relationshipError = await _verifyReplacementMetadata(job, source, linked);
		if (relationshipError) {
			await _setPhase(job, 'conflict', { lastError: relationshipError });
			return false;
		}
		if (!_canContinue()) return false;
		let root = _getRoot();
		await _assertJobRoot(job, root);
		if (!await _ensureMigrationOwner(job, root)) return false;
		let conflictingArtifacts = await _findRootArtifactConflicts(root, {
			instanceID: job.ownerInstanceID,
			rootGeneration: job.rootGeneration,
		});
		if (conflictingArtifacts.length) {
			await _setPhase(job, 'conflict', {
				lastError: _artifactConflictError(conflictingArtifacts),
				conflictingArtifacts,
			});
			return false;
		}
		let sourcePath = await source.getFilePathAsync();
		if (!sourcePath || !await _verifyCurrentSource(job, sourcePath)) return false;
		if (job.sourcePath && _normalizePath(job.sourcePath) != _normalizePath(sourcePath)) {
			await _setPhase(job, 'conflict', {
				lastError: 'The stored source path changed during migration',
			});
			return false;
		}
		relationshipError = await _verifyReplacementMetadata(job, source, linked);
		if (relationshipError) {
			await _setPhase(job, 'conflict', { lastError: relationshipError });
			return false;
		}
		let authorizationTargetPath = await linked.getFilePathAsync();
		let authorizationTargetIdentity = authorizationTargetPath
			&& await _fileIdentity(authorizationTargetPath);
		if (!authorizationTargetPath || !_sameIdentity(authorizationTargetIdentity, {
			size: job.sourceSize, sha256: job.sourceSHA256,
		})) {
			await _setPhase(job, 'conflict', {
				lastError: 'The linked target changed before source erasure was authorized',
			});
			return false;
		}
		// Persist the complete authorization before the storage side effect. If a
		// crash leaves the source row present after its bytes were removed, resume
		// may erase only after this exact target/root/ownership/child verification
		// is repeated. Early-phase missing sources never receive this milestone.
		job.eraseAuthorized = {
			v: 1,
			sourcePath,
			sourceIdentity: { size: job.sourceSize, sha256: job.sourceSHA256 },
			targetPath: authorizationTargetPath,
			targetIdentity: authorizationTargetIdentity,
			rootPath: job.rootPath || root,
			rootIdentity: job.rootIdentity,
			ownerID: job.ownerID,
			ownerInstanceID: job.ownerInstanceID,
			ownerGeneration: job.ownerGeneration,
			parentKey: job.parentKey,
			targetRelativePath: job.targetRelativePath,
			childIDs: [...job.childIDs],
			metadataSignature: job.sourceMetadataSignature,
			annotationStateTransferred: !!job.annotationStateTransferred,
			fulltextDisposition: job.fulltextDisposition || 'none',
			authorizedAt: _now(),
		};
		await _saveJob(job);

		if (source.id) {
			_managerOwnedErasures.add(source.id);
			try {
				let verificationFailure = false;
				try {
					await Zotero.DB.executeTransaction(async () => {
						let transactionalArtifacts = await _findRootArtifactConflicts(root, {
							instanceID: job.ownerInstanceID,
							rootGeneration: job.rootGeneration,
						});
						if (transactionalArtifacts.length) {
							verificationFailure = true;
							throw new Error(_artifactConflictError(transactionalArtifacts));
						}
						let transactionIdentity = await _rootIdentity(root);
						let transactionOwnerPath = PathUtils.join(root, OWNER_FILENAME);
						let transactionClaim = !_pathIsSymlink(transactionOwnerPath)
							&& await _readOwnerClaim(transactionOwnerPath);
						let transactionMarker = await _readRootMarker(root);
						let ownershipValid = transactionClaim?.v == 1
							&& transactionClaim.ownerID == job.ownerID
							&& transactionClaim.instanceID == job.ownerInstanceID
							&& transactionClaim.generation == job.ownerGeneration
							&& transactionClaim.rootGeneration == job.rootGeneration
							&& transactionMarker
							&& transactionClaim.rootGeneration == transactionMarker.generation
							&& transactionClaim.rootMarkerModified === transactionMarker.lastModified
							&& _sameRoot(transactionClaim.root, transactionIdentity)
							&& _sameRoot(job.rootIdentity, transactionIdentity);
						if (!ownershipValid) {
							verificationFailure = true;
							throw new Error('The organizer claim or root changed during erase verification');
						}
						let transactionTargetPath = await linked.getFilePathAsync();
						let transactionTargetIdentity = transactionTargetPath
							&& await _fileIdentity(transactionTargetPath);
						if (!transactionTargetPath
							|| _normalizePath(transactionTargetPath) != _normalizePath(authorizationTargetPath)
							|| !Zotero.File.directoryContains(root, transactionTargetPath)
							|| _containsSymlink(root, transactionTargetPath)
							|| !_sameIdentity(transactionTargetIdentity, authorizationTargetIdentity)
							|| !_sameIdentity(transactionTargetIdentity, {
								size: job.sourceSize, sha256: job.sourceSHA256,
							})) {
							verificationFailure = true;
							throw new Error('The linked replacement changed during erase verification');
						}
						// Repeat the metadata, child, relation, root and source checks in
						// the same transaction that erases the old item. This leaves no
						// window for a native child edit between the final check and erase.
						let transactionRelationshipError = await _verifyReplacementMetadata(
							job, source, linked
						);
						if (transactionRelationshipError) {
							verificationFailure = true;
							throw new Error(transactionRelationshipError);
						}
						let transactionSourcePath = await source.getFilePathAsync();
						let transactionSourceFileIdentity = transactionSourcePath
						&& await _fileIdentity(transactionSourcePath);
						if (!transactionSourcePath
								|| !_sameIdentity(transactionSourceFileIdentity, {
									size: job.sourceSize, sha256: job.sourceSHA256,
								})) {
							verificationFailure = true;
							throw new Error('The stored source changed during the erase check');
						}
						let erased = await source.erase({ tx: false });
						if (erased === false) throw new Error('The stored source could not be erased');
					});
				}
				catch (e) {
					if (verificationFailure) {
						await _setPhase(job, 'conflict', { lastError: e.message || String(e) });
					}
					throw e;
				}
			}
			finally {
				_managerOwnedErasures.delete(source.id);
			}
		}
		await _setPhase(job, 'source-erased');

		await _writeSetting(_settingKey(MANAGED_PREFIX, linked.libraryID, linked.key), {
			v: 2,
			libraryID: linked.libraryID,
			attachmentKey: linked.key,
			parentKey: job.parentKey,
			relativePath: job.targetRelativePath,
			rootPath: job.rootPath || root,
			rootIdentity: job.rootIdentity,
			providerID: _getProvider(root).id,
			sha256: job.sourceSHA256,
			size: job.sourceSize,
			revision: 0,
			fulltextDisposition: job.fulltextDisposition || 'none',
		});
		await _setPhase(job, 'complete', { lastError: null });
		return linked;
	}

	async function _resumeAuthorizedErase(job, source, lockToken) {
		if (!job.eraseAuthorized || job.phase != 'children-transferred') return null;
		let sourcePath;
		try {
			sourcePath = source.getFilePath();
		}
		catch {
			return null;
		}
		if (sourcePath && await IOUtils.exists(sourcePath)) return null;
		if (!sourcePath || !job.eraseAuthorized.sourcePath
				|| _normalizePath(sourcePath) != _normalizePath(job.eraseAuthorized.sourcePath)) {
			await _setWaiting(job, 'erase-authorized', {
				lastError: 'The source bytes are unavailable at the authorized storage path',
			});
			return false;
		}
		let linked = job.newAttachmentKey
			&& await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.newAttachmentKey);
		if (!linked?.isLinkedFileAttachment()) {
			await _setPhase(job, 'conflict', {
				lastError: 'The authorized linked replacement is unavailable',
			});
			return false;
		}
		let finish = token => _finishAuthorizedErase(job, source, linked, token);
		if (_isPDF(source)) {
			let coordinator = Zotero.AnnotationStorageCoordinator;
			return coordinator.withAttachmentLock(
				[source.id, linked.id], finish, lockToken
			);
		}
		return finish(lockToken);
	}

	async function _finishAuthorizedErase(job, source, linked, _lockToken) {
		let authorization = job.eraseAuthorized;
		let { root, validation, identity } = await _validateConfiguredRoot();
		if (!validation?.valid) {
			await _setWaiting(job, 'root-unavailable', {
				lastError: validation?.code || 'missing-root',
			});
			return false;
		}
		await _assertJobRoot(job, root);
		if (!await _ensureMigrationOwner(job, root)) return false;
		if (authorization.rootPath
				&& _normalizePath(authorization.rootPath) != _normalizePath(root)
				|| authorization.rootIdentity && !_sameRoot(authorization.rootIdentity, identity)
				|| authorization.ownerID != job.ownerID
				|| authorization.ownerInstanceID != job.ownerInstanceID
				|| authorization.ownerGeneration != job.ownerGeneration
				|| authorization.targetRelativePath != job.targetRelativePath
				|| authorization.parentKey != job.parentKey
				|| !_sameIdentity(authorization.sourceIdentity, {
					size: job.sourceSize, sha256: job.sourceSHA256,
				})) {
			await _setPhase(job, 'conflict', {
				lastError: 'The durable erase authorization no longer matches this migration',
			});
			return false;
		}
		let targetPath = await linked.getFilePathAsync();
		if (!targetPath || _normalizePath(targetPath) != _normalizePath(authorization.targetPath)
				|| !Zotero.File.directoryContains(root, targetPath)
				|| _containsSymlink(root, targetPath)) {
			await _setPhase(job, 'conflict', {
				lastError: 'The authorized linked replacement path changed',
			});
			return false;
		}
		let targetIdentity;
		try {
			targetIdentity = await _fileIdentity(targetPath);
		}
		catch (e) {
			await _setWaiting(job, 'erase-authorized', {
				lastError: e.message || 'The authorized linked replacement is unavailable',
			});
			return false;
		}
		if (!_sameIdentity(targetIdentity, authorization.targetIdentity)
				|| !_sameIdentity(targetIdentity, authorization.sourceIdentity)) {
			await _setPhase(job, 'conflict', {
				lastError: 'The authorized linked replacement bytes changed',
			});
			return false;
		}
		if (_isPDF(source) && !authorization.annotationStateTransferred) {
			await _setWaiting(job, 'annotation-transfer', {
				lastError: 'PDF annotation state transfer was not durably recorded',
			});
			return false;
		}
		if (!['none', 'reindexed'].includes(authorization.fulltextDisposition)
				|| !['none', 'reindexed'].includes(job.fulltextDisposition || 'none')) {
			try {
				if (!Zotero.Fulltext.indexItems) throw new Error('Full-text indexing is unavailable');
				await Zotero.Fulltext.indexItems([linked.id], { ignoreErrors: false });
				job.fulltextDisposition = 'reindexed';
				await _saveJob(job);
			}
			catch (e) {
				await _setWaiting(job, 'fulltext-reindex', { lastError: e.message || String(e) });
				return false;
			}
		}
		let relationshipError = await _verifyReplacementMetadata(job, source, linked);
		if (relationshipError) {
			await _setPhase(job, 'conflict', { lastError: relationshipError });
			return false;
		}
		let currentSourcePath = source.getFilePath();
		if (!currentSourcePath || _normalizePath(currentSourcePath)
				!= _normalizePath(authorization.sourcePath)) {
			await _setWaiting(job, 'erase-authorized', {
				lastError: 'The source storage path changed after erase authorization',
			});
			return false;
		}
		if (await IOUtils.exists(currentSourcePath)) return null;

		_managerOwnedErasures.add(source.id);
		try {
			let verificationFailure = false;
			try {
				await Zotero.DB.executeTransaction(async () => {
					let transactionalArtifacts = await _findRootArtifactConflicts(root, {
						instanceID: job.ownerInstanceID,
						rootGeneration: job.rootGeneration,
					});
					if (transactionalArtifacts.length) {
						verificationFailure = true;
						throw new Error(_artifactConflictError(transactionalArtifacts));
					}
					// Re-read the claim, marker and root identity inside the same
					// transaction boundary as source.erase(). A handover or replaced
					// root after the preflight must stop the destructive side effect.
					let transactionIdentity = await _rootIdentity(root);
					let transactionOwnerPath = PathUtils.join(root, OWNER_FILENAME);
					let transactionClaim = !_pathIsSymlink(transactionOwnerPath)
						&& await _readOwnerClaim(transactionOwnerPath);
					let transactionMarker = await _readRootMarker(root);
					let ownershipValid = transactionClaim?.v == 1
						&& transactionClaim.ownerID == job.ownerID
						&& transactionClaim.instanceID == job.ownerInstanceID
						&& transactionClaim.generation == job.ownerGeneration
						&& transactionClaim.rootGeneration == job.rootGeneration
						&& transactionMarker
						&& transactionClaim.rootGeneration == transactionMarker.generation
						&& transactionClaim.rootMarkerModified === transactionMarker.lastModified
						&& _sameRoot(transactionClaim.root, transactionIdentity)
						&& _sameRoot(job.rootIdentity, transactionIdentity);
					if (!ownershipValid) {
						verificationFailure = true;
						throw new Error('The organizer claim or root changed during authorized erase');
					}
					let transactionTargetPath = await linked.getFilePathAsync();
					let transactionTargetIdentity = transactionTargetPath
						&& await _fileIdentity(transactionTargetPath);
					if (!transactionTargetPath
							|| _normalizePath(transactionTargetPath) != _normalizePath(authorization.targetPath)
							|| !Zotero.File.directoryContains(root, transactionTargetPath)
							|| _containsSymlink(root, transactionTargetPath)
							|| !_sameIdentity(transactionTargetIdentity, authorization.targetIdentity)
							|| !_sameIdentity(transactionTargetIdentity, authorization.sourceIdentity)) {
						verificationFailure = true;
						throw new Error('The authorized linked replacement changed during erase verification');
					}
					let transactionRelationshipError = await _verifyReplacementMetadata(job, source, linked);
					if (transactionRelationshipError) {
						verificationFailure = true;
						throw new Error(transactionRelationshipError);
					}
					let transactionSourcePath = source.getFilePath();
					if (!transactionSourcePath
							|| _normalizePath(transactionSourcePath) != _normalizePath(authorization.sourcePath)
							|| await IOUtils.exists(transactionSourcePath)) {
						verificationFailure = true;
						throw new Error('The source bytes reappeared or its path changed during authorized erase');
					}
					let erased = await source.erase({ tx: false });
					if (erased === false) throw new Error('The stored source could not be erased');
				});
			}
			catch (e) {
				if (verificationFailure) {
					await _setPhase(job, 'conflict', { lastError: e.message || String(e) });
				}
				throw e;
			}
		}
		finally {
			_managerOwnedErasures.delete(source.id);
		}
		await _setPhase(job, 'source-erased');
		await _writeSetting(_settingKey(MANAGED_PREFIX, linked.libraryID, linked.key), {
			v: 2,
			libraryID: linked.libraryID,
			attachmentKey: linked.key,
			parentKey: job.parentKey,
			relativePath: job.targetRelativePath,
			rootPath: job.rootPath || root,
			rootIdentity: job.rootIdentity,
			providerID: _getProvider(root).id,
			sha256: job.sourceSHA256,
			size: job.sourceSize,
			revision: 0,
			fulltextDisposition: job.fulltextDisposition || 'none',
		});
		await _setPhase(job, 'complete', { lastError: null });
		return linked;
	}

	async function _processJob(itemID, reason, lockToken = null) {
		if (_paused || !Zotero.Prefs.get(PREF_ENABLED)) return false;
		let source = await Zotero.Items.getAsync(itemID);
		if (!await _eligibleItem(source)) return false;
		if (_isPDF(source) && !lockToken) {
			let coordinator = Zotero.AnnotationStorageCoordinator;
			if (!coordinator?.withAttachmentLock || !coordinator.reconcile
					|| !coordinator.transferState || !coordinator.clearLocalState) {
				let unavailableJob = await _loadOrCreateJob(source, reason);
				await _setWaiting(unavailableJob, 'annotation-capability-unavailable', {
					lastError: 'PDF annotation migration capability is unavailable',
				});
				return false;
			}
			return coordinator.withAttachmentLock(
				source.id,
				token => _processJob(itemID, reason, token)
			);
		}
		let job = await _loadOrCreateJob(source, reason);
		if (job.phase == 'complete') return Zotero.Items.getByLibraryAndKey(job.libraryID, job.newAttachmentKey);
		if (job.phase == 'conflict') return false;

		job.attempts = (job.attempts || 0) + 1;
		job.lastError = null;
		job.waitReason = null;
		await _saveJob(job);
		try {
			let { root, validation, identity } = await _validateConfiguredRoot();
			if (!validation?.valid) {
				await _setWaiting(job, 'root-unavailable', {
					lastError: validation ? validation.code : 'missing-root',
				});
				return false;
			}
			if (!await _ensureMigrationOwner(job, root)) return false;
			if (job.rootIdentity && !_sameRoot(job.rootIdentity, identity)) {
				await _setWaiting(job, 'organizer-root-mismatch', {
					lastError: 'The linked-folder root identity changed during migration',
				});
				return false;
			}
			Zotero.Prefs.set('saveRelativeAttachmentPath', true);

			if (_isOpenInReader(source.id)) {
				await _setWaiting(job, 'reader-open', { lastError: null });
				return false;
			}
			let authorizedResult = await _resumeAuthorizedErase(job, source, lockToken);
			if (authorizedResult !== null) return authorizedResult;
			let sourcePath = await _ensureSource(job, source);
			if (!sourcePath) return false;

			// Reconcile native and PDF annotation state while the source lock is
			// held, before taking the source hash or selecting the cloud target.
			// Reconciliation may rewrite the PDF. Pending recovery and conflicts
			// therefore stop conversion and leave the stored source in place.
			if (_isPDF(source) && job.phase == 'queued') {
				let coordinator = Zotero.AnnotationStorageCoordinator;
				try {
					let result = await coordinator.reconcile(source.id, 'migration', lockToken);
					if (result?.conflicts?.length) {
						await _setPhase(job, 'conflict', {
							lastError: 'PDF annotation state requires explicit conflict resolution before migration',
						});
						return false;
					}
					if (result?.pendingRepairs?.length) {
						await _setWaiting(job, 'annotation-reconcile', {
							lastError: 'PDF annotation recovery is pending before migration can continue',
						});
						return false;
					}
				}
				catch (e) {
					await _setWaiting(job, 'annotation-reconcile', {
						lastError: e.message || String(e),
					});
					return false;
				}
				sourcePath = await _ensureSource(job, source);
				if (!sourcePath) return false;
			}

			if (!job.targetPath) {
				let folder = await _chooseArticleFolder(source.parentItem);
				let sourceIdentity = await _fileIdentity(sourcePath);
				let target = await _chooseTarget(
					folder,
					_sanitizeFilename(source.attachmentFilename || _leafName(sourcePath), source.attachmentContentType)
				);
				let relative = Zotero.Attachments.getBaseDirectoryRelativePath(target.path);
				if (!relative.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) {
					throw new Error('Selected destination is outside the linked attachment base directory');
				}
				await _setPhase(job, 'target-selected', {
					targetFolder: folder,
					targetFilename: _leafName(target.path),
					targetPath: target.path,
					targetRelativePath: relative,
					sourceSize: sourceIdentity.size,
					sourceSHA256: sourceIdentity.sha256,
					newAttachmentKey: job.newAttachmentKey || Zotero.DataObjectUtilities.generateKey(),
					parentItemID: job.parentItemID || source.parentItemID,
					sourcePath,
					sourceMetadataSignature: _attachmentMetadataSignature(source),
					sourceRelationSignature: _relationSignature(source.getRelations()),
				});
			}
			if (!await _verifyCurrentSource(job, sourcePath)) return false;

			if (['target-selected', 'copied-temp'].includes(job.phase)) {
				await _copyAndVerify(job, sourcePath);
			}
			else if (['linked-item-created', 'children-transferred'].includes(job.phase)
					&& !await IOUtils.exists(job.targetPath)) {
				// A verified target may have disappeared while Zotero was paused. It
				// can be rebuilt from the unchanged source, while preserving the
				// durable child-transfer phase across the repair.
				await _copyAndVerify(job, sourcePath, { phaseAfter: job.phase });
			}
			if (!_canContinue()) return false;
			if (!await _verifyCurrentSource(job, sourcePath)) return false;
			let linked = await _createLinkedItem(job, source);
			if (!_canContinue()) return false;
			if (_isPDF(source)) {
				let coordinator = Zotero.AnnotationStorageCoordinator;
				// The annotation owner accepts the current token and retains the
				// expanded [source, target] critical section through erase.
				return await coordinator.withAttachmentLock(
					[source.id, linked.id],
					targetLockToken => _transferChildrenAndIndexes(job, source, linked, targetLockToken),
					lockToken
				);
			}
			return await _transferChildrenAndIndexes(job, source, linked, lockToken);
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
		await _normalizeJob(job);
		let source = await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.sourceKey);
		if (source) return this.queueAttachment(source.id, job.reason || reason);
		let linked = job.newAttachmentKey
			&& await Zotero.Items.getByLibraryAndKeyAsync(job.libraryID, job.newAttachmentKey);
		if (linked?.isLinkedFileAttachment()
				&& ['children-transferred', 'source-erased'].includes(job.phase)) {
			let { root, provider, validation, identity } = await _validateConfiguredRoot();
			if (!validation?.valid) {
				await _setWaiting(job, 'root-unavailable', {
					lastError: validation?.code || 'missing-root',
				});
				return false;
			}
			if (!await _ensureMigrationOwner(job, root)
					|| (job.rootIdentity && !_sameRoot(job.rootIdentity, identity))) return false;
			let path = await linked.getFilePathAsync();
			if (path && !_containsSymlink(root, path)
					&& _sameIdentity(await _fileIdentity(path), {
						size: job.sourceSize,
						sha256: job.sourceSHA256,
					})) {
				let replacementError = await _verifyLinkedReplacementAfterSourceGone(job, linked);
				if (replacementError) {
					await _setPhase(job, 'conflict', { lastError: replacementError });
					return false;
				}
				if (['reindex-required', 'reindex-pending'].includes(job.fulltextDisposition)) {
					try {
						if (!Zotero.Fulltext.indexItems) throw new Error('Full-text indexing is unavailable');
						await Zotero.Fulltext.indexItems([linked.id], { ignoreErrors: false });
						job.fulltextDisposition = 'reindexed';
					}
					catch (e) {
						await _setWaiting(job, 'fulltext-reindex', { lastError: e.message || String(e) });
						return false;
					}
				}
				await _writeSetting(_settingKey(MANAGED_PREFIX, linked.libraryID, linked.key), {
					v: 2,
					libraryID: linked.libraryID,
					attachmentKey: linked.key,
					parentKey: job.parentKey,
					relativePath: job.targetRelativePath,
					rootPath: job.rootPath || root,
					rootIdentity: job.rootIdentity || identity,
					providerID: provider.id,
					sha256: job.sourceSHA256,
					size: job.sourceSize,
					revision: 0,
					fulltextDisposition: job.fulltextDisposition || 'none',
				});
				await _setPhase(job, 'complete', { lastError: null });
				return linked;
			}
		}
		if (linked?.isLinkedFileAttachment()) {
			await _setPhase(job, 'conflict', {
				lastError: 'The source disappeared before attachment metadata transfer was verified',
			});
		}
		return false;
	}

	async function _getRows(prefix = '') {
		if (prefix) {
			return Zotero.DB.queryAsync(
				'SELECT key, value FROM settings WHERE setting=? AND key LIKE ?',
				[SETTING, `${prefix}%`]
			);
		}
		return Zotero.DB.queryAsync(
			'SELECT key, value FROM settings WHERE setting=?',
			[SETTING]
		);
	}

	async function _managedPath(record, { requireCurrentRoot = true } = {}) {
		let root = _getRoot();
		if (!root || !record?.relativePath
				|| !record.relativePath.startsWith(Zotero.Attachments.BASE_PATH_PLACEHOLDER)) return null;
		if (requireCurrentRoot && record.rootPath
				&& _normalizePath(record.rootPath) != _normalizePath(root)) return null;
		if (requireCurrentRoot && record.rootIdentity) {
			let currentIdentity;
			try {
				currentIdentity = await _rootIdentity(root);
			}
			catch {
				return null;
			}
			if (!_sameRoot(record.rootIdentity, currentIdentity)) return null;
		}
		let path;
		try {
			path = Zotero.Attachments.resolveRelativePath(record.relativePath);
		}
		catch {
			return null;
		}
		if (!path || !Zotero.File.directoryContains(root, path) || _containsSymlink(root, path)) return null;
		return path;
	}

	async function _observeManagedRevision(itemID) {
		let item = await Zotero.Items.getAsync(itemID);
		if (!item?.isLinkedFileAttachment()) return false;
		let record = await _readSetting(_settingKey(MANAGED_PREFIX, item.libraryID, item.key));
		if (!record) return false;
		let path = await _managedPath(record);
		if (!path || !await IOUtils.exists(path)) return false;
		let identity = await _fileIdentity(path);
		if (_sameIdentity(identity, { size: record.size, sha256: record.sha256 })) return false;
		// A file notification proves only that bytes changed. It does not prove
		// that Zotero (or the annotation coordinator) performed and verified the
		// write. Keep the old identity as the migration/deletion guard and expose
		// the change for explicit review instead of blessing an arbitrary replace.
		await _recordOrphan(record, 'managed-file-identity-mismatch-at-notification');
		return false;
	}

	/**
	 * Return the current managed-file write guard. The caller must invoke the
	 * public wrapper while its trusted write coordinator owns the attachment
	 * lock; the wrapper itself supplies the expected pre-write identity to the
	 * operation and verifies the post-write bytes before recording a revision.
	 */
	async function _managedWriteContext(itemID) {
		let item = await Zotero.Items.getAsync(itemID);
		if (!item?.isLinkedFileAttachment()) return null;
		let key = _settingKey(MANAGED_PREFIX, item.libraryID, item.key);
		let record = await _readSetting(key);
		if (!record) return null;
		let path = await _managedPath(record);
		if (!path || !await IOUtils.exists(path)) {
			await _recordOrphan(record, 'managed-file-unavailable-before-verified-write');
			throw new Error('The managed linked file is unavailable before a verified write');
		}
		let beforeIdentity = await _fileIdentity(path);
		if (!_sameIdentity(beforeIdentity, { size: record.size, sha256: record.sha256 })) {
			await _recordOrphan(record, 'managed-file-identity-mismatch-before-verified-write');
			// A cloud peer may have edited the file. Keep the old identity as
			// deletion evidence, but let the annotation coordinator inspect and
			// reconcile the file under its normal conflict rules. This wrapper must
			// never turn an untrusted pre-existing replacement into a new revision.
			return { item, key, record, path, beforeIdentity, trustedBefore: false };
		}
		return { item, key, record, path, beforeIdentity, trustedBefore: true };
	}

	async function _recordVerifiedManagedWrite(context, result) {
		let { record, key, path, beforeIdentity } = context;
		let currentRecord = await _readSetting(key);
		if (!currentRecord || currentRecord.revision != record.revision
				|| !_sameIdentity(currentRecord, record)) {
			await _recordOrphan(record, 'managed-file-record-changed-during-verified-write');
			throw new Error('The managed linked-file record changed during the verified write');
		}
		let currentPath = await _managedPath(currentRecord);
		if (!currentPath || _normalizePath(currentPath) != _normalizePath(path)) {
			await _recordOrphan(record, 'managed-file-path-changed-during-verified-write');
			throw new Error('The managed linked-file path changed during the verified write');
		}
		let afterIdentity;
		try {
			afterIdentity = await _verifiedFileIdentity(currentPath, result?.fileToken);
		}
		catch (e) {
			await _recordOrphan(record, 'managed-file-unavailable-after-verified-write');
			throw e;
		}
		let resultIdentity = result?.verifiedIdentity || result?.fileIdentity;
		if (result?.verified === false || result?.verifiedWrite === false
				|| resultIdentity && !_sameIdentity(afterIdentity, resultIdentity)) {
			await _recordOrphan(record, 'managed-file-post-write-verification-failed');
			throw new Error('The managed linked-file write was not verified');
		}
		if (!context.trustedBefore) return result;
		if (_sameIdentity(afterIdentity, beforeIdentity)) return result;
		Object.assign(currentRecord, {
			v: 2,
			previousIdentity: beforeIdentity,
			size: afterIdentity.size,
			sha256: afterIdentity.sha256,
			revision: (currentRecord.revision || 0) + 1,
			lastEditedAt: _now(),
			revisionEvidence: {
				source: 'verified-managed-write',
				verifiedAt: _now(),
				expectedIdentity: beforeIdentity,
			},
		});
		await _writeSetting(key, currentRecord);
		return result;
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
			let path = await _managedPath(record);
			if (!path || !await IOUtils.exists(path)) {
				await _recordOrphan(record, 'managed-file-unavailable-at-deletion');
				continue;
			}
			let identity = await _fileIdentity(path);
			if (!_sameIdentity(identity, { size: record.size, sha256: record.sha256 })) {
				await _recordOrphan(record, 'managed-file-identity-mismatch-at-deletion');
				continue;
			}
			plans.push({ attachment, record, path, identity });
		}
		return plans;
	}

	async function _recordOrphan(record, reason) {
		let key = _settingKey(ORPHAN_PREFIX, record.libraryID, record.attachmentKey);
		await _writeSetting(key, {
			...record,
			v: 2,
			reason,
			state: 'needs-review',
			orphanedAt: _now(),
		});
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
				else {
					await this.pause();
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
		_managerOwnedErasures.clear();
		_initialized = false;
	};

	this.notify = async function (event, type, ids, extraData) {
		if (type == 'item' && ['add', 'modify'].includes(event)) {
			if (!Zotero.Prefs.get(PREF_ENABLED)) return;
			for (let id of ids) {
				if (extraData?.[id]?.linkedFolderAttachmentManager) continue;
				_observeManagedRevision(id).catch(Zotero.logError);
				this.queueAttachment(id, `notifier-${event}`).catch(Zotero.logError);
			}
		}
		else if (type == 'file' && ['download', 'modify'].includes(event)) {
			if (!Zotero.Prefs.get(PREF_ENABLED)) return;
			for (let id of ids) {
				_observeManagedRevision(id).catch(Zotero.logError);
				this.queueAttachment(id, `notifier-file-${event}`).catch(Zotero.logError);
			}
		}
		else if (type == 'item' && event == 'delete') {
			for (let id of ids) {
				if (_managerOwnedErasures.has(id)) continue;
				let libraryID = extraData?.[id]?.libraryID;
				let key = extraData?.[id]?.key;
				if (!libraryID || !key) continue;
				let record = await _readSetting(_settingKey(MANAGED_PREFIX, libraryID, key));
				if (record) await _recordOrphan(record, 'noninteractive-item-deletion');
			}
		}
	};

	/**
	 * Guard a write performed by the annotation coordinator or another trusted
	 * Zotero writer. Unmanaged attachments pass through unchanged. For a
	 * managed attachment, the operation receives the path and the known
	 * pre-write identity; its successful result may include `verifiedIdentity`
	 * when the writer has an independent post-write identity. The actual bytes,
	 * root and managed record are always checked here before a revision is
	 * persisted. Callers must hold their attachment lock for the whole call.
	 */
	this.withManagedFileWrite = async function (itemID, operation) {
		if (typeof operation != 'function') throw new TypeError('A write operation is required');
		let context = await _managedWriteContext(itemID);
		if (!context) return operation();
		let result = await operation({
			path: context.path,
			beforeIdentity: { ...context.beforeIdentity },
			trustedBefore: context.trustedBefore,
		});
		return _recordVerifiedManagedWrite(context, result);
	};

	this.queueAttachment = async function (itemID, reason = 'manual') {
		let item = await Zotero.Items.getAsync(itemID);
		let queueKey = item?.parentKey
			? `${item.libraryID}/${item.parentKey}`
			: `item/${itemID}`;
		let previous = _queues.get(queueKey) || Promise.resolve();
		let next = previous.catch(Zotero.logError).then(() => _processJob(itemID, reason));
		_queues.set(queueKey, next);
		try {
			return await next;
		}
		finally {
			if (_queues.get(queueKey) == next) _queues.delete(queueKey);
		}
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
				+ 'AND I.itemID NOT IN (SELECT itemID FROM deletedItems)',
			[
				libraryID,
				Zotero.Attachments.LINK_MODE_IMPORTED_FILE,
				Zotero.Attachments.LINK_MODE_IMPORTED_URL,
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
		let { validation } = await _validateConfiguredRoot();
		if (!validation?.valid) throw new Error(`Linked folder is unavailable: ${validation?.code || 'missing-root'}`);
		return _chooseArticleFolder(parent);
	};

	this.previewMigration = async function (libraryID = Zotero.Libraries.userLibraryID) {
		let ids = await Zotero.DB.columnQueryAsync(
			'SELECT IA.itemID FROM itemAttachments IA JOIN items I USING (itemID) '
				+ 'WHERE I.libraryID=? AND IA.parentItemID IS NOT NULL AND IA.linkMode IN (?, ?) '
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
				if (job.libraryID == libraryID) {
					await _normalizeJob(job);
					jobs.push(job);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		let counts = {};
		for (let job of jobs) counts[job.phase] = (counts[job.phase] || 0) + 1;
		let waitingJobs = jobs.filter(job => job.waitReason || job.status == 'waiting'
			|| WAITING_PHASES.has(job.phase));
		let failedJobs = jobs.filter(job => !waitingJobs.includes(job)
			&& (job.phase == 'conflict' || job.lastError));
		return {
			libraryID,
			paused: _paused,
			active: _queues.size,
			total: jobs.length,
			complete: counts.complete || 0,
			failed: failedJobs.length,
			waiting: waitingJobs.length,
			progress: {
				version: 1,
				total: jobs.length,
				complete: counts.complete || 0,
				failed: failedJobs.length,
				waiting: waitingJobs.length,
			},
			counts,
			jobs,
		};
	};

	this.getOrganizerStatus = async function () {
		return _getClaimStatus();
	};

	this.claimOrganizer = async function () {
		let { root, validation, identity } = await _validateConfiguredRoot();
		if (!validation?.valid) {
			throw new Error(`Linked folder is unavailable: ${validation?.code || 'missing-root'}`);
		}
		let ownerID = Zotero.Users.getLocalUserKey();
		let instanceID = await _getInstallationID();
		let ownerPath = PathUtils.join(root, OWNER_FILENAME);
		if (_pathIsSymlink(ownerPath)) throw new Error('The organizer claim is a symlink');
		let marker = await _readRootMarker(root);
		let current = await _readOwnerClaim(ownerPath);
		let conflictingArtifacts = await _findRootArtifactConflicts(root, {
			instanceID,
			rootGeneration: marker?.generation,
		});
		if (conflictingArtifacts.length) {
			throw new Error(_artifactConflictError(conflictingArtifacts));
		}
		if (current) {
			if (current.v == 1 && current.ownerID == ownerID
					&& current.instanceID == instanceID && marker
					&& current.rootGeneration == marker.generation
					&& current.rootMarkerModified === marker.lastModified
					&& (!current.root || _sameRoot(current.root, identity))) {
				return _getClaimStatus();
			}
			if (current.ownerID == ownerID && current.instanceID == instanceID) {
				throw new Error('The linked-folder root generation changed or is unavailable');
			}
			throw new Error('Another Zotero installation already owns linked-folder migration');
		}
		marker ||= await _ensureRootMarker(root);
		let claim = {
			v: 1,
			ownerID,
			instanceID,
			generation: Zotero.Utilities.randomString(24),
			rootGeneration: marker.generation,
			rootMarkerModified: marker.lastModified,
			root: identity,
			createdAt: _now(),
		};
		let tempPath = `${ownerPath}.tmp-${instanceID}`;
		let writeIdentity = await _rootIdentity(root);
		if (!_sameRoot(writeIdentity, identity) || _containsSymlink(root, root)
				|| _pathIsSymlink(ownerPath)) {
			throw new Error('The linked-folder root changed while claiming organizer ownership');
		}
		await IOUtils.writeJSON(tempPath, claim);
		try {
			await IOUtils.move(tempPath, ownerPath, { noOverwrite: true });
		}
		catch (e) {
			await IOUtils.remove(tempPath, { ignoreAbsent: true });
			current = await _readOwnerClaim(ownerPath);
			if (!current || current.ownerID != ownerID || current.instanceID != instanceID) throw e;
		}
		return _getClaimStatus();
	};

	this.releaseOrganizer = async function () {
		await this.pause();
		if (_queues.size) await Promise.allSettled([..._queues.values()]);
		let { root, identity } = await _validateConfiguredRoot();
		if (!root || !identity) return _getClaimStatus();
		let ownerPath = PathUtils.join(root, OWNER_FILENAME);
		let claim = await _readOwnerClaim(ownerPath);
		let ownerID = Zotero.Users.getLocalUserKey();
		let instanceID = await _getInstallationID();
		if (!claim) return _getClaimStatus();
		let marker = await _readRootMarker(root);
		if (claim.ownerID != ownerID || claim.instanceID != instanceID
				|| !marker || claim.rootGeneration != marker.generation
				|| claim.rootMarkerModified !== marker.lastModified
				|| (claim.root && !_sameRoot(claim.root, identity))) {
			throw new Error('Cannot release another Zotero installation organizer claim');
		}
		let conflictingArtifacts = await _findRootArtifactConflicts(root, {
			instanceID,
			rootGeneration: marker.generation,
		});
		if (conflictingArtifacts.length) {
			throw new Error(_artifactConflictError(conflictingArtifacts));
		}
		await IOUtils.remove(ownerPath);
		return _getClaimStatus();
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
			if (job.libraryID != libraryID || job.phase == 'complete') continue;
			if (job.phase == 'conflict') {
				// Conflicts require an explicit user retry after the conflicting
				// artifact or identity is resolved. Resume the last durable phase so
				// the normal verification path runs again from that checkpoint.
				if (!job.resumePhase || job.resumePhase == 'complete') continue;
				job.phase = job.resumePhase;
				job.progressPhase = job.resumePhase;
				job.status = 'running';
				job.waitReason = null;
				job.resumePhase = null;
				job.conflictingArtifacts = null;
			}
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
		if (!entries.length) return { approved: true, destructive: false, entries: [] };
		let approved = false;
		if (interactive) {
			approved = Services.prompt.confirm(
				null,
				'Linked Cloud Folder',
				`Move ${entries.length} managed linked file${entries.length == 1 ? '' : 's'} to the macOS Trash after deleting the Zotero item${entries.length == 1 ? '' : 's'}?`
			);
		}
		return {
			approved,
			destructive: interactive && approved,
			reviewRequired: !interactive,
			entries: approved
				? entries.map(({ record, path, identity }) => ({ record, path, identity }))
				: interactive ? [] : entries.map(({ record, path, identity }) => ({ record, path, identity })),
		};
	};

	this.completeManagedFileDeletion = async function (plan) {
		if (!plan) return { moved: 0, orphaned: 0 };
		if (!plan.destructive) {
			for (let entry of plan.entries || []) {
				await _recordOrphan(entry.record, 'noninteractive-item-deletion');
			}
			return { moved: 0, orphaned: (plan.entries || []).length };
		}
		if (!plan.approved) return { moved: 0, orphaned: 0 };
		let moved = 0;
		let orphaned = 0;
		for (let entry of plan.entries) {
			try {
				let { root, validation } = await _validateConfiguredRoot();
				if (!validation?.valid) {
					throw new Error('The linked-folder root changed before managed-file deletion');
				}
				let conflictingArtifacts = await _findRootArtifactConflicts(root);
				if (conflictingArtifacts.length) {
					throw new Error(_artifactConflictError(conflictingArtifacts));
				}
				let currentPath = await _managedPath(entry.record);
				if (!entry.path || !currentPath
						|| _normalizePath(currentPath) != _normalizePath(entry.path)
						|| !Zotero.File.directoryContains(root, currentPath)
						|| _containsSymlink(root, currentPath)) {
					throw new Error('Managed file path is outside the current linked-folder root');
				}
				entry.path = currentPath;
				let exists = await IOUtils.exists(currentPath);
				if (entry.identity) {
					let currentIdentity = exists && await _fileIdentity(currentPath);
					if (!_sameIdentity(currentIdentity, entry.identity)) {
						throw new Error('Managed file changed after deletion was confirmed');
					}
				}
				else if (exists) {
					throw new Error('A file appeared at the managed path after deletion was confirmed');
				}
				let provider = _getProvider(root);
				if (!provider.moveToTrash) throw new Error('Provider does not support moving files to Trash');
				if (exists) {
					if (!await provider.moveToTrash(currentPath)) {
						throw new Error('Managed file could not be moved to Trash');
					}
					moved++;
				}
				let folder = PathUtils.parent(currentPath);
				if (folder != root && await IOUtils.exists(folder)) {
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

	this.getOrphans = async function (libraryID = Zotero.Libraries.userLibraryID) {
		let rows = await _getRows(ORPHAN_PREFIX);
		let orphans = [];
		for (let row of rows) {
			try {
				let record = JSON.parse(row.value);
				if (record.libraryID == libraryID) orphans.push(record);
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		return orphans;
	};

	this.reviewOrphan = async function (libraryID, attachmentKey, action) {
		let settingKey = _settingKey(ORPHAN_PREFIX, libraryID, attachmentKey);
		let record = await _readSetting(settingKey);
		if (!record) return { action, found: false };
		if (!['reveal', 'retain', 'dismiss', 'trash'].includes(action)) {
			throw new Error(`Unknown orphan review action: ${action}`);
		}
		if (action == 'reveal') {
			let path = await _managedPath(record);
			if (path && await IOUtils.exists(path)) Zotero.File.reveal(path);
			return { action, found: true, path: path || null, state: record.state };
		}
		if (action == 'retain') {
			record.state = 'retained';
			record.reviewedAt = _now();
			await _writeSetting(settingKey, record);
			return { action, found: true, state: record.state };
		}
		if (action == 'dismiss') {
			record.state = 'dismissed';
			record.reviewedAt = _now();
			await _writeSetting(settingKey, record);
			return { action, found: true, state: record.state };
		}

		let organizer = await _getClaimStatus();
		if (!organizer.isOrganizer) {
			return {
				action,
				found: true,
				trashed: false,
				state: record.state || 'needs-review',
				reason: 'organizer-required',
			};
		}
		if (!Zotero.isMac) {
			return { action, found: true, trashed: false, state: record.state, reason: 'unsupported-platform' };
		}
		let path = await _managedPath(record);
		let identity = path && await IOUtils.exists(path) && await _fileIdentity(path);
		if (!path || !_sameIdentity(identity, { size: record.size, sha256: record.sha256 })) {
			await _recordOrphan(record, 'managed-file-identity-mismatch-at-orphan-review');
			return { action, found: true, trashed: false, state: 'needs-review', reason: 'identity-mismatch' };
		}
		let approved = Services.prompt.confirm(
			null,
			'Linked Cloud Folder',
			`Move ${_leafName(path)} to the macOS Trash?`
		);
		if (!approved) return { action, found: true, trashed: false, state: record.state, reason: 'cancelled' };
		// The prompt is a confirmation boundary. Revalidate the organizer claim,
		// configured root, managed mapping and bytes after it, immediately before
		// moving anything to Trash.
		let confirmedOrganizer = await _getClaimStatus();
		let { root: confirmedRoot, validation } = await _validateConfiguredRoot();
		let conflictingArtifacts = validation?.valid && confirmedRoot
			&& await _findRootArtifactConflicts(confirmedRoot, {
				instanceID: confirmedOrganizer.instanceID,
				rootGeneration: confirmedOrganizer.generation,
			});
		let confirmedPath = await _managedPath(record);
		if (conflictingArtifacts?.length) {
			await _recordOrphan(record, _artifactConflictError(conflictingArtifacts));
			return {
				action, found: true, trashed: false, state: 'needs-review',
				reason: 'conflict', conflictingArtifacts,
			};
		}
		if (!confirmedOrganizer.isOrganizer || !validation?.valid || !confirmedPath
				|| _normalizePath(confirmedPath) != _normalizePath(path)
				|| !Zotero.File.directoryContains(confirmedRoot, confirmedPath)
				|| _containsSymlink(confirmedRoot, confirmedPath)) {
			await _recordOrphan(record, 'managed-file-root-changed-during-orphan-review');
			return { action, found: true, trashed: false, state: 'needs-review', reason: 'root-changed' };
		}
		path = confirmedPath;
		identity = await IOUtils.exists(path) && await _fileIdentity(path);
		if (!identity || !_sameIdentity(identity, { size: record.size, sha256: record.sha256 })) {
			await _recordOrphan(record, 'managed-file-changed-during-orphan-review');
			return { action, found: true, trashed: false, state: 'needs-review', reason: 'identity-mismatch' };
		}
		let provider = _getProvider(confirmedRoot);
		if (!provider?.moveToTrash) {
			await _recordOrphan(record, 'provider-trash-unavailable');
			return { action, found: true, trashed: false, state: 'needs-review', reason: 'provider-trash-unavailable' };
		}
		if (!_sameIdentity(await _fileIdentity(path), identity)) {
			await _recordOrphan(record, 'managed-file-changed-during-orphan-review');
			return { action, found: true, trashed: false, state: 'needs-review', reason: 'identity-mismatch' };
		}
		let moved = await provider.moveToTrash(path);
		if (!moved) return { action, found: true, trashed: false, state: record.state, reason: 'not-moved' };
		await _deleteSetting(settingKey);
		await _deleteSetting(_settingKey(
			MANAGED_PREFIX,
			record.libraryID,
			record.attachmentKey
		));
		let folder = PathUtils.parent(path);
		if (folder != confirmedRoot && await IOUtils.exists(folder)
				&& !(await IOUtils.getChildren(folder)).length) {
			await IOUtils.remove(folder);
		}
		return { action, found: true, trashed: true, state: 'trashed' };
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
