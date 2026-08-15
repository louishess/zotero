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
 * Profiles for cloud services that expose a synchronized folder on the local
 * filesystem. Profiles provide discovery and setup guidance only; attachment
 * paths and file operations remain ordinary Zotero relative linked files.
 */
Zotero.LinkedFolderProviders = new function () {
	const _providers = new Map();

	function _normalize(path) {
		if (typeof path != 'string' || !path.trim()) {
			throw new Error("A non-empty path is required");
		}
		return PathUtils.normalize(path.trim());
	}

	function _pathMatches(path, patterns) {
		let normalized;
		try {
			normalized = _normalize(path).replace(/\\/g, '/').toLowerCase();
		}
		catch {
			return false;
		}
		return patterns.some(pattern => pattern.test(normalized));
	}

	async function _validateRoot(path) {
		let normalized;
		try {
			normalized = _normalize(path);
		}
		catch {
			return { valid: false, code: 'invalid-path', path: null };
		}

		if (!PathUtils.isAbsolute(normalized)) {
			return { valid: false, code: 'not-absolute', path: normalized };
		}
		if (!(await IOUtils.exists(normalized))) {
			return { valid: false, code: 'missing', path: normalized };
		}

		let stat;
		try {
			stat = await IOUtils.stat(normalized);
		}
		catch {
			return { valid: false, code: 'unavailable', path: normalized };
		}
		if (stat.type != 'directory') {
			return { valid: false, code: 'not-directory', path: normalized };
		}

		let dataDir = Zotero.DataDirectory.dir;
		if (dataDir && (PathUtils.normalize(dataDir) == normalized
				|| Zotero.File.directoryContains(dataDir, normalized)
				|| Zotero.File.directoryContains(normalized, dataDir))) {
			return { valid: false, code: 'inside-data-directory', path: normalized };
		}
		if (!Zotero.File.pathToFile(normalized).isWritable()) {
			return { valid: false, code: 'not-writable', path: normalized };
		}

		// Checking access bits is insufficient for an unavailable File Provider
		// mount. Exercise the actual mounted filesystem with an empty probe file.
		let probe = PathUtils.join(
			normalized,
			`.zotero-write-test-${Zotero.Utilities.randomString(12)}`
		);
		try {
			await IOUtils.write(probe, new Uint8Array());
			await IOUtils.remove(probe);
		}
		catch {
			try {
				await IOUtils.remove(probe, { ignoreAbsent: true });
			}
			catch (cleanupError) {
				Zotero.logError(cleanupError);
			}
			return { valid: false, code: 'write-test-failed', path: normalized };
		}

		return { valid: true, code: 'ok', path: normalized };
	}

	async function _moveToTrash(path) {
		if (!Zotero.isMac) {
			throw new Error("Moving linked-folder files to Trash is only supported on macOS");
		}

		let normalized = _normalize(path);
		if (!PathUtils.isAbsolute(normalized) || PathUtils.parent(normalized) == normalized) {
			throw new Error("Refusing to move an unsafe path to Trash");
		}
		if (!(await IOUtils.exists(normalized))) {
			return false;
		}

		let trashDir = PathUtils.join(OS.Constants.Path.homeDir, '.Trash');
		if (!(await IOUtils.exists(trashDir))) {
			throw new Error("The macOS Trash directory is unavailable");
		}
		if (normalized == trashDir
				|| Zotero.File.directoryContains(normalized, trashDir)
				|| Zotero.File.directoryContains(trashDir, normalized)) {
			throw new Error("Refusing to move an unsafe path to Trash");
		}

		return Zotero.File.moveToUnique(
			normalized,
			PathUtils.join(trashDir, PathUtils.filename(normalized))
		);
	}

	function _makeProfile({ id, label, patterns, availabilityHint }) {
		let profile = {
			id,
			label,
			detect: path => _pathMatches(path, patterns),
			validateRoot: _validateRoot,
			availabilityHint,
		};
		if (Zotero.isMac) {
			profile.moveToTrash = _moveToTrash;
		}
		return profile;
	}

	this.register = function (profile) {
		if (!profile || typeof profile != 'object') {
			throw new Error("Provider profile must be an object");
		}
		if (!profile.id || !/^[a-z][a-z0-9-]*$/.test(profile.id)) {
			throw new Error("Provider profile has an invalid id");
		}
		if (_providers.has(profile.id)) {
			throw new Error(`Provider profile '${profile.id}' is already registered`);
		}
		if (typeof profile.label != 'string'
				|| typeof profile.detect != 'function'
				|| typeof profile.validateRoot != 'function'
				|| typeof profile.availabilityHint != 'string'
				|| (profile.moveToTrash && typeof profile.moveToTrash != 'function')) {
			throw new Error(`Provider profile '${profile.id}' is incomplete`);
		}

		let registered = Object.freeze({ ...profile });
		_providers.set(registered.id, registered);
		return registered;
	};

	this.get = function (id) {
		return _providers.get(id) || null;
	};

	this.getAll = function () {
		return [..._providers.values()];
	};

	this.detect = function (path) {
		for (let provider of _providers.values()) {
			if (provider.id != 'local-folder' && provider.detect(path)) {
				return provider;
			}
		}
		return this.get('local-folder');
	};

	this.register(_makeProfile({
		id: 'box-drive',
		label: 'Box Drive',
		patterns: [
			/\/library\/cloudstorage\/box(?:-box)?(?:\/|$)/,
			/^\/users\/[^/]+\/box(?:\/|$)/,
		],
		availabilityHint: 'Keep this folder available offline in Box Drive while Zotero is migrating attachments.',
	}));

	this.register(_makeProfile({
		id: 'dropbox',
		label: 'Dropbox',
		patterns: [
			/\/library\/cloudstorage\/dropbox(?:-[^/]+)?(?:\/|$)/,
			/^\/users\/[^/]+\/dropbox(?:\s*\([^/]+\))?(?:\/|$)/,
		],
		availabilityHint: 'Keep this folder available offline in Dropbox while Zotero is migrating attachments.',
	}));

	this.register(_makeProfile({
		id: 'google-drive',
		label: 'Google Drive',
		patterns: [
			/\/library\/cloudstorage\/googledrive-[^/]+(?:\/|$)/,
			/^\/users\/[^/]+\/google drive(?:\/|$)/,
		],
		availabilityHint: 'Keep this folder available offline in Google Drive while Zotero is migrating attachments.',
	}));

	this.register(_makeProfile({
		id: 'local-folder',
		label: 'Other Local Folder',
		patterns: [/.*/],
		availabilityHint: 'Keep this folder mounted and writable while Zotero is migrating attachments.',
	}));
};
