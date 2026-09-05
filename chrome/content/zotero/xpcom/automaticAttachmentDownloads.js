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
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

"use strict";

/**
 * Device-local policy for automatic attachment downloads.
 *
 * This policy deliberately does not apply to explicit user downloads or forced
 * storage recovery. Unknown file types retain stock Zotero behavior.
 */
Zotero.AutomaticAttachmentDownloads = new function () {
	const PREF_PREFIX = "automaticAttachmentDownloads.";
	const GENERIC_MIME_TYPES = new Set([
		"application/octet-stream",
		"application/x-octet-stream",
		"application/binary",
		"application/x-binary",
		"binary/octet-stream",
		"application/download",
		"application/x-download",
		"application/force-download",
		"application/unknown",
	]);

	const TYPE_DEFINITIONS = [
		{
			key: "pdf",
			extension: "pdf",
			mimeTypes: [
				"application/pdf",
				"application/x-pdf",
				"application/acrobat",
				"applications/vnd.pdf",
				"text/pdf",
				"text/x-pdf",
			],
		},
		{
			key: "docx",
			extension: "docx",
			mimeTypes: [
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			],
		},
		{
			key: "md",
			extension: "md",
			mimeTypes: ["text/markdown", "text/x-markdown"],
		},
		{
			key: "xlsx",
			extension: "xlsx",
			mimeTypes: [
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			],
		},
		{
			key: "mp3",
			extension: "mp3",
			mimeTypes: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
		},
		{
			key: "mp4",
			extension: "mp4",
			mimeTypes: ["video/mp4", "audio/mp4", "application/mp4"],
		},
		{
			key: "webm",
			extension: "webm",
			mimeTypes: ["video/webm", "audio/webm"],
		},
	];

	this.TYPES = Object.freeze(TYPE_DEFINITIONS.map(type => Object.freeze({
		...type,
		mimeTypes: Object.freeze([...type.mimeTypes]),
	})));
	this.VERSION = 1;
	this.PREFERENCE_PREFIX = PREF_PREFIX;

	const MIME_TYPE_MAP = new Map();
	const EXTENSION_MAP = new Map();
	for (let type of this.TYPES) {
		EXTENSION_MAP.set(type.extension, type.key);
		for (let mimeType of type.mimeTypes) {
			MIME_TYPE_MAP.set(mimeType, type.key);
		}
	}

	let _initialized = false;
	let _prefObserverIDs = [];

	this.init = function () {
		if (_initialized) {
			return;
		}
		_initialized = true;

		for (let { key } of this.TYPES) {
			let observerID = Zotero.Prefs.registerObserver(PREF_PREFIX + key, (enabled) => {
				if (enabled) {
					this.invalidatePendingStorageDownloads().catch(Zotero.logError);
				}
			});
			_prefObserverIDs.push(observerID);
		}

		Zotero.addShutdownListener(() => {
			for (let observerID of _prefObserverIDs) {
				Zotero.Prefs.unregisterObserver(observerID);
			}
			_prefObserverIDs = [];
			_initialized = false;
		});
	};

	/**
	 * Return the controlled type key for attachment metadata, or null when the
	 * type is not controlled by this policy.
	 *
	 * @param {Object} metadata
	 * @param {String} [metadata.contentType]
	 * @param {String} [metadata.filename]
	 * @param {String} [metadata.url]
	 * @return {String|null}
	 */
	this.classify = function ({ contentType, filename, url } = {}) {
		let normalizedContentType = typeof contentType == "string"
			? contentType.split(";", 1)[0].trim().toLowerCase()
			: "";
		if (normalizedContentType && !GENERIC_MIME_TYPES.has(normalizedContentType)) {
			return MIME_TYPE_MAP.get(normalizedContentType) || null;
		}

		let extension = _getExtension(filename) || _getExtension(url);
		return extension ? (EXTENSION_MAP.get(extension) || null) : null;
	};

	this.isTypeEnabled = function (typeKey) {
		if (!EXTENSION_MAP.has(typeKey)) {
			throw new Error(`Unknown automatic attachment download type '${typeKey}'`);
		}
		return Zotero.Prefs.get(PREF_PREFIX + typeKey);
	};

	/**
	 * Return the serializable policy used by the Connector while it is
	 * connected to this Desktop instance. The Connector must not persist this
	 * object: preference changes are picked up by the next ping.
	 */
	this.getPolicy = function () {
		return {
			version: this.VERSION,
			types: this.TYPES.map(type => ({
				key: type.key,
				extension: type.extension,
				mimeTypes: [...type.mimeTypes],
			})),
			genericMIMETypes: [...GENERIC_MIME_TYPES],
			enabled: Object.fromEntries(this.TYPES.map(type => [
				type.key,
				this.isTypeEnabled(type.key),
			])),
		};
	};

	/**
	 * Decide whether a download may proceed. Explicit and forced operations
	 * always bypass exclusions.
	 */
	this.shouldDownload = function ({
		contentType,
		filename,
		url,
		automatic = true,
		force = false,
	} = {}) {
		if (!automatic || force) {
			return true;
		}
		let typeKey = this.classify({ contentType, filename, url });
		return !typeKey || this.isTypeEnabled(typeKey);
	};

	this.shouldDownloadItem = function (item, { automatic = true, force = false } = {}) {
		if (!item || !item.isAttachment()) {
			throw new Error("Attachment item not provided");
		}
		return this.shouldDownload({
			contentType: item.attachmentContentType,
			filename: item.attachmentFilename,
			url: item.getField("url"),
			automatic,
			force,
		});
	};

	/**
	 * Ensure a newly enabled type is reconsidered by the next ordinary file
	 * sync, even if an earlier filtered sync reached the current library version.
	 */
	this.invalidatePendingStorageDownloads = async function () {
		if (!Zotero.Libraries || !Zotero.Libraries.getAll) {
			return;
		}
		for (let library of Zotero.Libraries.getAll()) {
			if (!["user", "group", "publications"].includes(library.libraryType)) {
				continue;
			}
			library.storageVersion = -1;
			library.storageDownloadNeeded = true;
			await library.saveTx({ skipNotifier: true });
		}
	};

	function _getExtension(value) {
		if (!value || typeof value != "string") {
			return null;
		}
		let path = value;
		try {
			path = new URL(value).pathname;
		}
		catch {
			path = value.split(/[?#]/, 1)[0];
		}
		let leafName = path.split(/[\\/]/).pop();
		let match = leafName && leafName.match(/\.([^.]+)$/);
		return match ? match[1].toLowerCase() : null;
	}
};
