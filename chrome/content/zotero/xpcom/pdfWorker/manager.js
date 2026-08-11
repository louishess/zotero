/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2020 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
                     http://digitalscholar.org/
    
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

const WORKER_URL = 'resource://zotero/document-worker/worker.js';
const ASSETS_URL = 'resource://zotero/document-worker/';
const READER_PDF_ASSETS_URL = 'resource://zotero/reader/pdf/web/';

function getAssetURL(path) {
	if (path.startsWith('cmaps/') || path.startsWith('standard_fonts/')) {
		return READER_PDF_ASSETS_URL + path;
	}
	return ASSETS_URL + path;
}

class PDFWorker {
	constructor() {
		this._worker = null;
		this._lastPromiseID = 0;
		this._waitingPromises = {};
		this._queue = [];
		this._processingQueue = false;
		this._fileAnnotationStates = new Map();
		this._lastFileAnnotationOperationID = 0;
	}

	async _processQueue() {
		this._init();
		if (this._processingQueue) {
			return;
		}
		this._processingQueue = true;
		let item;
		while ((item = this._queue.shift())) {
			if (item) {
				let [fn, resolve, reject] = item;
				try {
					resolve(await fn());
				}
				catch (e) {
					reject(e);
				}
			}
		}
		this._processingQueue = false;
		// this._worker.terminate();
		// this._worker = null;
	}

	async _enqueue(fn, isPriority) {
		return new Promise((resolve, reject) => {
			if (isPriority) {
				this._queue.unshift([fn, resolve, reject]);
			}
			else {
				this._queue.push([fn, resolve, reject]);
			}
			this._processQueue();
		});
	}

	async _query(action, data, transfer, options = {}) {
		return new Promise((resolve, reject) => {
			this._lastPromiseID++;
			this._waitingPromises[this._lastPromiseID] = {
				resolve,
				reject,
				onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
			};
			this._worker.postMessage({ id: this._lastPromiseID, action, data }, transfer);
		});
	}

	/**
	 * Log and rethrow a worker error wrapped with the action name and
	 * optional context, restoring the error name (e.g., 'PasswordException')
	 * from the worker error JSON
	 */
	_throwWorkerError(action, e, details = {}) {
		let error = new Error(`Worker action '${action}' failed: ${JSON.stringify({ ...details, error: e.message })}`);
		try {
			error.name = JSON.parse(e.message).name;
		}
		catch (e) {
			Zotero.logError(e);
		}
		Zotero.logError(error);
		throw error;
	}

	_init() {
		if (this._worker) return;
		this._worker = new Worker(WORKER_URL);
		this._worker.addEventListener('message', async (event) => {
			let message = event.data;
			if ('progressID' in message) {
				let promise = this._waitingPromises[message.progressID];
				if (promise?.onProgress) {
					try {
						promise.onProgress(message.data?.progress);
					}
					catch {
						// Progress reporting is best-effort and must not affect extraction.
					}
				}
				return;
			}
			if ('responseID' in message) {
				let promise = this._waitingPromises[message.responseID];
				if (!promise) {
					Zotero.debug(`Received response from PDF worker for unknown request ${message.responseID}`);
					return;
				}
				delete this._waitingPromises[message.responseID];
				let { resolve, reject } = promise;
				if ('error' in message) {
					reject(new Error(JSON.stringify(message.error)));
				}
				else {
					resolve(message.data);
				}
				return;
			}
			if ('id' in message) {
				let respData = null;
				try {
					if (message.action === 'FetchData') {
						let response = await Zotero.HTTP.request(
							'GET',
							getAssetURL(message.data),
							{ responseType: 'arraybuffer' }
						);
						respData = new Uint8Array(response.response);
					}
				}
				catch (e) {
					Zotero.debug(`Failed to fetch data (${message.data}):`);
					Zotero.debug(e);
				}
				try {
					if (message.action === 'SaveRenderedAnnotation') {
						let { libraryID, annotationKey, buf } = message.data;
						let annotationItem = Zotero.Items.getByLibraryAndKey(libraryID, annotationKey);
						let win = Zotero.getMainWindow();
						let blob = new win.Blob([new Uint8Array(buf)]);
						await Zotero.Annotations.saveCacheImage(annotationItem, blob);
						await Zotero.Notifier.trigger('modify', 'item', [annotationItem.id]);
						respData = true;
					}
				}
				catch (e) {
					Zotero.debug('Failed to save rendered annotation:');
					Zotero.logError(e);
				}
				this._worker.postMessage(
					{ responseID: event.data.id, data: respData },
					respData instanceof Uint8Array ? [respData.buffer] : []
				);
			}
		});
		this._worker.addEventListener('error', (event) => {
			Zotero.logError(`Document worker error (${event.filename}:${event.lineno}): ${event.message}`);
		});
	}
	
	canImport(item) {
		if (item.isPDFAttachment()) {
			return true;
		}
		else if (item.isRegularItem()) {
			let ids = item.getAttachments();
			for (let id of ids) {
				let attachment = Zotero.Items.get(id);
				if (attachment.isPDFAttachment()) {
					return true;
				}
			}
		}
	}

	async canUseFileAnnotations(item) {
		if (!Zotero.Prefs.get('reader.annotations.saveToFile')
			|| !item?.isPDFAttachment()
			|| item.library.libraryType !== 'user'
			|| !item.library.editable
			|| !item.library.filesEditable
			|| !item.isEditable()
			|| item.deleted
			|| item.parentItem?.deleted) {
			return false;
		}

		let path = await item.getFilePathAsync();
		if (!path) return false;
		try {
			let file = Zotero.File.pathToFile(path);
			return file.isWritable() && file.parent.isWritable();
		}
		catch (e) {
			Zotero.logError(e);
			return false;
		}
	}

	async _getFileToken(path) {
		let { size, lastModified } = await IOUtils.stat(path);
		return { size, lastModified };
	}

	_fileTokensEqual(a, b) {
		return !!a && !!b && a.size === b.size && a.lastModified === b.lastModified;
	}

	_fileTokenKey(token) {
		return token ? `${token.size}:${token.lastModified}` : '';
	}

	_registerFileAnnotationRead(itemID, fileToken) {
		let state = this._fileAnnotationStates.get(itemID);
		if (state && this._fileTokensEqual(state.fileToken, fileToken)) {
			return state;
		}
		state = {
			fileToken,
			fileRevision: (state?.fileRevision || 0) + 1,
			knownTokenKeys: new Set([this._fileTokenKey(fileToken)])
		};
		this._fileAnnotationStates.set(itemID, state);
		return state;
	}

	_getExpectedFileAnnotationState(expectedFileState) {
		if (!expectedFileState) return {};
		if (expectedFileState.fileToken) {
			return expectedFileState;
		}
		// Temporary compatibility for callers using the original token-only API.
		return { fileToken: expectedFileState };
	}

	_assertFileAnnotationState(itemID, currentToken, expectedFileState) {
		let expected = this._getExpectedFileAnnotationState(expectedFileState);
		let state = this._fileAnnotationStates.get(itemID);
		if (!state) {
			if (expected.fileToken && !this._fileTokensEqual(currentToken, expected.fileToken)) {
				throw this._newFileChangedError('PDF file changed since annotations were loaded');
			}
			return this._registerFileAnnotationRead(itemID, currentToken);
		}

		// The disk must still contain the last revision observed or written by this
		// process. An older caller revision is safe to rebase only when its token is
		// also part of the current Zotero-authored history.
		if (!this._fileTokensEqual(currentToken, state.fileToken)
			|| (expected.fileToken
				&& !state.knownTokenKeys.has(this._fileTokenKey(expected.fileToken)))
			|| (expected.fileRevision && expected.fileRevision > state.fileRevision)) {
			throw this._newFileChangedError('PDF file changed since annotations were loaded');
		}
		return state;
	}

	_newFileChangedError(message) {
		let error = new Error(message);
		error.name = 'FileChangedException';
		return error;
	}

	/**
	 * Read supported annotations directly from a PDF without creating Zotero items.
	 */
	async readAnnotations(itemID, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}
			let path = await attachment.getFilePathAsync();
			if (!path) {
				throw new Error('PDF attachment file not found');
			}
			let fileToken = await this._getFileToken(path);
			if (fileToken.size > Math.pow(2, 31) - 1) {
				throw new Error(`The file "${path}" is too large`);
			}
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;
			let readToken = await this._getFileToken(path);
			if (!this._fileTokensEqual(fileToken, readToken)) {
				let error = new Error('PDF file changed while annotations were being loaded');
				error.name = 'FileChangedException';
				throw error;
			}
			try {
				var { annotations } = await this._query('pdf.readAnnotations', {
					buf, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.readAnnotations', e);
			}

			for (let annotation of annotations) {
				annotation.tags = (annotation.tags || []).map(name => ({ name }));
			}
			let state = this._registerFileAnnotationRead(itemID, fileToken);
			return { annotations, fileToken, fileRevision: state.fileRevision };
		}, isPriority);
	}

	/**
	 * Atomically apply annotation changes to the original PDF.
	 */
	async applyAnnotationChanges(itemID, changes, expectedFileState, isPriority, password) {
		return this._enqueue(async () => {
			let operationID = ++this._lastFileAnnotationOperationID;
			let attachment = await Zotero.Items.getAsync(itemID);
			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}
			if (!(await this.canUseFileAnnotations(attachment))) {
				throw new Error('PDF is not eligible for file-backed annotations');
			}
			let path = await attachment.getFilePathAsync();
			if (!path) {
				throw new Error('PDF attachment file not found');
			}
			let initialToken = await this._getFileToken(path);
			let state = this._assertFileAnnotationState(
				itemID,
				initialToken,
				expectedFileState
			);
			if (initialToken.size > Math.pow(2, 31) - 1) {
				throw new Error(`The file "${path}" is too large`);
			}

			let workerChanges = {
				upserts: (changes.upserts || []).map(({ annotation, source }) => ({
					annotation: {
						...annotation,
						tags: (annotation.tags || []).map(tag => tag.name || tag)
					},
					source
				})),
				deletions: changes.deletions || []
			};
			for (let { annotation } of workerChanges.upserts) {
				delete annotation.image;
				delete annotation.readOnly;
				delete annotation.isExternal;
				delete annotation.onlyTextOrComment;
				delete annotation.source;
				delete annotation.transferable;
			}
			let changeSummary = {
				upserts: workerChanges.upserts.map(({ annotation }) => ({
					id: annotation.id,
					type: annotation.type
				})),
				deletions: workerChanges.deletions.length
			};
			Zotero.debug(
				`File-backed annotation operation ${operationID} for item ${itemID}: `
				+ JSON.stringify({
					...changeSummary,
					expectedRevision: this._getExpectedFileAnnotationState(expectedFileState).fileRevision,
					currentRevision: state.fileRevision,
					initialToken
				})
			);

			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;
			try {
				var { buf: modifiedBuf } = await this._query('pdf.applyAnnotationChanges', {
					buf, changes: workerChanges, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.applyAnnotationChanges', e, changeSummary);
			}

			let currentToken = await this._getFileToken(path);
			if (!this._fileTokensEqual(initialToken, currentToken)) {
				throw this._newFileChangedError('PDF file changed while annotations were being saved');
			}

			let tmpPath = `${path}.zotero-annotations-${operationID}-${Zotero.Utilities.randomString(8)}.tmp`;
			try {
				await IOUtils.write(path, new Uint8Array(modifiedBuf), { tmpPath });
			}
			finally {
				if (await IOUtils.exists(tmpPath)) {
					await IOUtils.remove(tmpPath);
				}
			}
			let fileToken = await this._getFileToken(path);
			state.fileToken = fileToken;
			state.fileRevision++;
			state.knownTokenKeys.add(this._fileTokenKey(fileToken));
			while (state.knownTokenKeys.size > 32) {
				state.knownTokenKeys.delete(state.knownTokenKeys.values().next().value);
			}
			attachment.attachmentLastProcessedModificationTime = Math.floor(fileToken.lastModified / 1000);
			await attachment.saveTx({ skipAll: true });
			Zotero.debug(
				`Completed file-backed annotation operation ${operationID} for item ${itemID}: `
				+ JSON.stringify({ fileRevision: state.fileRevision, fileToken })
			);
			return {
				fileToken,
				fileRevision: state.fileRevision,
				sources: Object.fromEntries(
					workerChanges.upserts.map(({ annotation }) => [
						annotation.id,
						{ type: 'zotero', id: annotation.id }
					])
				)
			};
		}, isPriority);
	}

	async migrateAnnotationsToFile(itemID, isPriority, password) {
		let attachment = await Zotero.Items.getAsync(itemID);
		let annotationItems = attachment.getAnnotations();
		let internalItems = annotationItems.filter(item => !item.annotationIsExternal);
		let externalItems = annotationItems.filter(item => item.annotationIsExternal);
		let { fileToken, fileRevision } = await this.readAnnotations(itemID, isPriority, password);
		if (internalItems.length) {
			let upserts = [];
			for (let item of internalItems) {
				let annotation = await Zotero.Annotations.toJSON(item);
				annotation.id = item.key;
				delete annotation.key;
				upserts.push({ annotation });
			}
			({ fileToken, fileRevision } = await this.applyAnnotationChanges(
				itemID,
				{ upserts },
				{ fileToken, fileRevision },
				isPriority,
				password
			));
		}

		let { annotations } = await this.readAnnotations(itemID, isPriority, password);
		let embeddedIDs = new Set(annotations.map(annotation => annotation.id).filter(Boolean));
		let missingIDs = internalItems.map(item => item.key).filter(key => !embeddedIDs.has(key));
		if (missingIDs.length) {
			throw new Error(`Failed to verify migrated PDF annotations: ${missingIDs.join(', ')}`);
		}

		// External annotation items are a cache of annotations read from the PDF.
		// Verify each cached source still exists before removing those rows.
		let getExternalKey = annotation => {
			let position = annotation.position || JSON.parse(annotation.annotationPosition);
			let type = annotation.type || annotation.annotationType;
			let key = type + position.pageIndex;
			if (type === 'ink') {
				key += position.width + JSON.stringify(position.paths);
			}
			else {
				key += JSON.stringify(position.rects);
			}
			return key + (annotation.comment || annotation.annotationComment || '');
		};
		let embeddedExternalCounts = new Map();
		let migratedInternalIDs = new Set(internalItems.map(item => item.key));
		for (let annotation of annotations.filter(annotation => !migratedInternalIDs.has(annotation.id))) {
			let key = getExternalKey(annotation);
			embeddedExternalCounts.set(key, (embeddedExternalCounts.get(key) || 0) + 1);
		}
		let missingExternalKeys = [];
		for (let item of externalItems) {
			let key = getExternalKey(item);
			let count = embeddedExternalCounts.get(key) || 0;
			if (!count) {
				missingExternalKeys.push(item.key);
			}
			else {
				embeddedExternalCounts.set(key, count - 1);
			}
		}
		if (missingExternalKeys.length) {
			throw new Error(
				`Failed to verify cached PDF annotations: ${missingExternalKeys.join(', ')}`
			);
		}
		if (annotationItems.length) {
			await Zotero.Items.erase(annotationItems.map(item => item.id));
		}
		return this.readAnnotations(itemID, isPriority, password);
	}

	async renderAnnotationImage(itemID, annotation, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			let path = await attachment.getFilePathAsync();
			if (!path) return null;
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;
			let rect = annotation.position?.rects?.[0];
			if (!rect && annotation.position?.paths) {
				let xs = annotation.position.paths.flatMap(path => path.filter((_x, i) => i % 2 === 0));
				let ys = annotation.position.paths.flatMap(path => path.filter((_y, i) => i % 2 === 1));
				let padding = (annotation.position.width || 1) * 2;
				rect = [
					Math.min(...xs) - padding,
					Math.min(...ys) - padding,
					Math.max(...xs) + padding,
					Math.max(...ys) + padding
				];
			}
			if (!rect) return null;
			try {
				var { buf: imageBuf } = await this._query('pdf.renderArea', {
					buf,
					pageIndex: annotation.position.pageIndex,
					rect,
					scale: 2,
					password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.renderArea', e);
			}
			if (!imageBuf) return null;
			let bytes = new Uint8Array(imageBuf);
			let binary = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			}
			return 'data:image/png;base64,' + btoa(binary);
		}, isPriority);
	}
	
	/**
	 * Export attachment with annotations to specified path
	 *
	 * @param {Integer} itemID
	 * @param {String} path
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise<Integer>} Number of written annotations
	 */
	async export(itemID, path, isPriority, password, transfer) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}
			let t = new Date();
			Zotero.debug(`Exporting PDF for item ${attachment.libraryKey}`);
			let items = attachment.getAnnotations();
			items = items.filter(x => !x.annotationIsExternal);
			let annotations = [];
			for (let item of items) {
				annotations.push({
					id: item.key,
					type: item.annotationType,
					// Author name is only set when the PDF file is 1) in a group library,
					// 2) was moved back to a private library or 3) was imported from a PDF file
					// that was previously exported in 1) or 2) case
					authorName: item.annotationAuthorName || Zotero.Users.getName(item.createdByUserID) || '',
					comment: (item.annotationComment || '').replace(/<\/?(i|b|sub|sup)>/g, ''),
					color: item.annotationColor,
					position: JSON.parse(item.annotationPosition),
					dateModified: Zotero.Date.sqlToISO8601(item.dateModified),
					tags: item.getTags().map(x => x.tag)
				});
			}
			let attachmentPath = await attachment.getFilePathAsync();
			if (!attachmentPath) {
				Zotero.warn("Not exporting missing file " + attachment.getFilePath());
				return 0;
			}
			if (!annotations.length) {
				await Zotero.File.copyFile(attachmentPath, path);
				return 0;
			}
			let buf = await IOUtils.read(attachmentPath);
			buf = new Uint8Array(buf).buffer;

			try {
				var res = await this._query('pdf.writeAnnotations', {
					buf, annotations, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.writeAnnotations', e, { annotations });
			}
			
			await IOUtils.write(path, new Uint8Array(res.buf));
			
			if (transfer) {
				await Zotero.Items.erase(items.map(x => x.id));
			}
			
			Zotero.debug(`Exported PDF with ${annotations.length} annotation(s) in ${new Date() - t} ms`);
			
			return annotations.length;
		}, isPriority);
	}

	/**
	 * Export children PDF attachments with annotations
	 *
	 * @param {Zotero.Item} item
	 * @param {String} directory
	 * @param {Boolean} [isPriority]
	 */
	async exportParent(item, directory, isPriority) {
		if (!item.isRegularItem()) {
			throw new Error('Item must be a regular item');
		}
		if (!directory) {
			throw new Error('\'directory\' not provided');
		}
		let promises = [];
		let ids = item.getAttachments();
		for (let id of ids) {
			let attachment = Zotero.Items.get(id);
			if (attachment.isPDFAttachment()) {
				let path = OS.Path.join(directory, attachment.attachmentFilename);
				promises.push(this.export(id, path, isPriority));
			}
		}
		await Promise.all(promises);
	}

	/**
	 * Import annotations from PDF attachment
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @param {Boolean} transfer
	 * @returns {Promise<Boolean>} Whether any annotations were imported/deleted
	 */
	async import(itemID, isPriority, password, transfer) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			
			Zotero.debug("Importing annotations for item " + attachment.libraryKey);
			let t = new Date();
			
			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let mtime = Math.floor((await attachment.attachmentModificationTime) / 1000);
			if (!transfer && attachment.attachmentLastProcessedModificationTime === mtime) {
				Zotero.debug("File hasn't changed since last-processed time -- skipping annotations import");
				return false;
			}

			let existingAnnotations = attachment
			.getAnnotations()
			.filter(x => x.annotationIsExternal)
			.map(annotation => ({
				id: annotation.key,
				type: annotation.annotationType,
				position: JSON.parse(annotation.annotationPosition),
				comment: annotation.annotationComment || ''
			}));

			let path = await attachment.getFilePathAsync();
			let fileSize = (await IOUtils.stat(path)).size;
			if (fileSize > Math.pow(2, 31) - 1) {
				throw new Error(`The file "${path}" is too large`);
			}
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var { imported, deleted, buf: modifiedBuf } = await this._query('pdf.importAnnotations', {
					buf, existingAnnotations, password, transfer
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.importAnnotations', e, { existingAnnotations });
			}
			
			let ids = [];
			for (let key of deleted) {
				let annotation = Zotero.Items.getByLibraryAndKey(attachment.libraryID, key);
				if (annotation) {
					ids.push(annotation.id);
				}
			}
			if (ids.length) {
				await Zotero.Items.erase(ids);
			}
			
			let notifierQueue = new Zotero.Notifier.Queue();
			try {
				for (let annotation of imported) {
					annotation.key = Zotero.DataObjectUtilities.generateKey();
					annotation.isExternal = !(transfer && annotation.transferable);
					annotation.tags = annotation.tags.map(x => ({ name: x }));
					await Zotero.Annotations.saveFromJSON(attachment, annotation, {
						notifierQueue
					});
				}
			}
			finally {
				await Zotero.Notifier.commit(notifierQueue);
			}
			
			if (transfer) {
				if (modifiedBuf) {
					await IOUtils.write(path, new Uint8Array(modifiedBuf));
					mtime = Math.floor((await attachment.attachmentModificationTime) / 1000);
				}
			}

			attachment.attachmentLastProcessedModificationTime = mtime;
			await attachment.saveTx({
				skipAll: true
			});
			
			Zotero.debug(`Imported ${imported.length} annotation(s) for item ${attachment.libraryKey} `
				+ `in ${new Date() - t} ms`);
			
			return !!(imported.length || deleted.length);
		}, isPriority);
	}

	async processCitaviAnnotations(pdfPath, citaviAnnotations, isPriority, password) {
		return this._enqueue(async () => {
			let fileSize = (await IOUtils.stat(pdfPath)).size;
			if (fileSize > Math.pow(2, 31) - 1) {
				throw new Error(`The file "${pdfPath}" is too large`);
			}
			let buf = await IOUtils.read(pdfPath);
			buf = new Uint8Array(buf).buffer;
			try {
				var annotations = await this._query('pdf.importCitaviAnnotations', {
					buf, citaviAnnotations, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.importCitaviAnnotations', e, { citaviAnnotations });
			}
			return annotations;
		}, isPriority);
	}
	
	/**
	 * Process Mendeley annotations by extending with data from PDF file
	 *
	 * @param {String} pdfPath PDF file path
	 * @param {Array} mendeleyAnnotations
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise<Array>} Partial annotations
	 */
	async processMendeleyAnnotations(pdfPath, mendeleyAnnotations, isPriority, password) {
		return this._enqueue(async () => {
			let fileSize = (await IOUtils.stat(pdfPath)).size;
			if (fileSize > Math.pow(2, 31) - 1) {
				throw new Error(`The file "${pdfPath}" is too large`);
			}
			let buf = await IOUtils.read(pdfPath);
			buf = new Uint8Array(buf).buffer;
			try {
				var annotations = await this._query('pdf.importMendeleyAnnotations', {
					buf, mendeleyAnnotations, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.importMendeleyAnnotations', e, { mendeleyAnnotations });
			}
			return annotations;
		}, isPriority);
	}
	
	/**
	 * Import annotations for each PDF attachment of parent item
	 *
	 * @param {Zotero.Item} item
	 * @param {Boolean} [isPriority]
	 */
	async importParent(item, isPriority) {
		if (!item.isRegularItem()) {
			throw new Error('Item must be a regular item');
		}
		let promises = [];
		let ids = item.getAttachments();
		for (let id of ids) {
			let attachment = Zotero.Items.get(id);
			if (attachment.isPDFAttachment()) {
				promises.push(this.import(id, isPriority));
			}
		}
		await Promise.all(promises);
	}

	/**
	 * Delete pages from PDF attachment
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Array} pageIndexes
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise}
	 */
	async deletePages(itemID, pageIndexes, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);

			Zotero.debug(`Deleting [${pageIndexes.join(', ')}] pages for item ${attachment.libraryKey}`);
			let t = new Date();

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let annotations = attachment
				.getAnnotations()
				.map(annotation => ({
					id: annotation.id,
					position: JSON.parse(annotation.annotationPosition)
				}));

			let path = await attachment.getFilePathAsync();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var { buf: modifiedBuf } = await this._query('pdf.deletePages', {
					buf, pageIndexes, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.deletePages', e);
			}

			// Delete annotations from deleted pages
			let ids = [];
			for (let i = annotations.length - 1; i >= 0; i--) {
				let { id, position } = annotations[i];
				if (pageIndexes.includes(position.pageIndex)) {
					ids.push(id);
					annotations.splice(i, 1);
				}
			}
			if (ids.length) {
				await Zotero.Items.erase(ids);
			}

			// Shift page index for other annotations
			ids = [];
			await Zotero.DB.executeTransaction(async function () {
				let rows = await Zotero.DB.queryAsync('SELECT itemID, position FROM itemAnnotations WHERE parentItemID=?', itemID);
				for (let { itemID, position } of rows) {
					try {
						position = JSON.parse(position);
					}
					catch (e) {
						Zotero.logError(e);
						continue;
					}
					// Find the count of deleted pages before the current annotation page
					let shift = pageIndexes.reduce((prev, cur) => cur < position.pageIndex ? prev + 1 : prev, 0);
					if (shift > 0) {
						position.pageIndex -= shift;
						position = JSON.stringify(position);
						await Zotero.DB.queryAsync('UPDATE itemAnnotations SET position=? WHERE itemID=?', [position, itemID]);
						ids.push(itemID);
					}
				}
			});
			let objectsClass = Zotero.DataObjectUtilities.getObjectsClassForObjectType('item');
			let loadedObjects = objectsClass.getLoaded();
			for (let object of loadedObjects) {
				if (ids.includes(object.id)) {
					await object.reload(null, true);
				}
			}
			await Zotero.Items.updateSynced(ids, false);
			await Zotero.Notifier.trigger('modify', 'item', ids, {});

			await IOUtils.write(path, new Uint8Array(modifiedBuf));
			let mtime = Math.floor((await attachment.attachmentModificationTime) / 1000);
			attachment.attachmentLastProcessedModificationTime = mtime;
			await attachment.saveTx({
				skipAll: true
			});

			Zotero.debug(`Deleted pages for item ${attachment.libraryKey} in ${new Date() - t} ms`);
		}, isPriority);
	}

	/**
	 * Rotate pages in PDF attachment
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Array} pageIndexes
	 * @param {Integer} degrees 90, 180, 270
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise}
	 */
	async rotatePages(itemID, pageIndexes, degrees, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);

			Zotero.debug(`Rotating [${pageIndexes.join(', ')}] pages for item ${attachment.libraryKey}`);
			let t = new Date();

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let path = await attachment.getFilePathAsync();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var { buf: modifiedBuf } = await this._query('pdf.rotatePages', {
					buf, pageIndexes, degrees, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.rotatePages', e);
			}

			await IOUtils.write(path, new Uint8Array(modifiedBuf));
			let mtime = Math.floor((await attachment.attachmentModificationTime) / 1000);
			attachment.attachmentLastProcessedModificationTime = mtime;
			await attachment.saveTx({
				skipAll: true
			});

			Zotero.debug(`Rotated pages for item ${attachment.libraryKey} in ${new Date() - t} ms`);
		}, isPriority);
	}

	/**
	 * Get fulltext
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Integer|null} maxPages Pages count to extract, or all pages if 'null'
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise}
	 */
	async getFullText(itemID, maxPages, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);

			Zotero.debug(`Getting fulltext content from item ${attachment.libraryKey}`);
			let t = new Date();

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let path = await attachment.getFilePathAsync();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var result = await this._query('pdf.getFulltext', {
					buf, maxPages, password
				}, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.getFulltext', e);
			}

			Zotero.debug(`Extracted full text for item ${attachment.libraryKey} in ${new Date() - t} ms`);

			return result;
		}, isPriority);
	}

	/**
	 * Get structured document text for a PDF, EPUB, or snapshot attachment
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Object} [options]
	 * @param {Boolean} [options.isPriority]
	 * @param {String} [options.password]
	 * @param {Function} [options.onProgress]
	 * @returns {Promise<Object|null>}
	 */
	async getStructuredDocumentText(itemID, { isPriority = false, password, onProgress } = {}) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			if (!(attachment.isPDFAttachment()
					|| attachment.isEPUBAttachment()
					|| attachment.isSnapshotAttachment())) {
				throw new Error('Item must be a PDF, EPUB, or snapshot attachment');
			}

			let path = await attachment.getFilePathAsync();
			if (!path) {
				return null;
			}

			let sourceHash = await attachment.attachmentHash;
			if (!sourceHash) {
				throw new Error('Attachment is missing an MD5 hash');
			}

			Zotero.debug(`Getting structured document text from item ${attachment.libraryKey}`);
			let t = new Date();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var result = await this._query('getStructuredDocumentText', {
					buf,
					contentType: attachment.attachmentContentType,
					password,
					sourceHash,
					reportProgress: typeof onProgress === 'function',
				}, [buf], {
					onProgress,
				});
			}
			catch (e) {
				this._throwWorkerError('getStructuredDocumentText', e);
			}

			Zotero.debug(`Extracted structured document text for item ${attachment.libraryKey} in ${new Date() - t} ms`);

			return result;
		}, !!isPriority);
	}

	/**
	 * Get data for recognizer-server
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise}
	 */
	async getRecognizerData(itemID, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);

			Zotero.debug(`Getting PDF recognizer data from item ${attachment.libraryKey}`);
			let t = new Date();

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let path = await attachment.getFilePathAsync();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var result = await this._query('pdf.getRecognizerData', { buf, password }, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.getRecognizerData', e);
			}

			Zotero.debug(`Extracted PDF recognizer data for item ${attachment.libraryKey} in ${new Date() - t} ms`);

			return result;
		}, isPriority);
	}

	async renderAttachmentAnnotations(itemID, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);
			let t = new Date();

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let annotations = [];
			for (let annotation of attachment.getAnnotations()) {
				if (['image', 'ink'].includes(annotation.annotationType)
					&& !(await Zotero.Annotations.hasCacheImage(annotation))) {
					annotations.push({
						id: annotation.key,
						color: annotation.annotationColor,
						position: JSON.parse(annotation.annotationPosition)
					});
				}
			}
			if (!annotations.length) {
				return 0;
			}

			Zotero.debug(`Rendering ${annotations.length} annotation(s) for attachment ${attachment.key}`);

			let path = await attachment.getFilePathAsync();
			if (!path) {
				return 0;
			}
			let buf = await OS.File.read(path, {});
			buf = new Uint8Array(buf).buffer;

			let { libraryID } = attachment;

			try {
				var result = await this._query('pdf.renderAnnotations', { libraryID, buf, annotations, password }, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.renderAnnotations', e);
			}

			Zotero.debug(`Rendered ${annotations.length} PDF annotation(s) ${attachment.libraryKey} in ${new Date() - t} ms`);

			return result;
		}, isPriority);
	}

	/**
	 * Determine whether the PDF has any embedded annotations
	 *
	 * @param {Integer} itemID Attachment item id
	 * @param {Boolean} [isPriority]
	 * @param {String} [password]
	 * @returns {Promise<Boolean>}
	 */
	async hasAnnotations(itemID, isPriority, password) {
		return this._enqueue(async () => {
			let attachment = await Zotero.Items.getAsync(itemID);

			Zotero.debug(`Detecting embedded annotations in item ${attachment.libraryKey}`);

			if (!attachment.isPDFAttachment()) {
				throw new Error('Item must be a PDF attachment');
			}

			let path = await attachment.getFilePathAsync();
			let buf = await IOUtils.read(path);
			buf = new Uint8Array(buf).buffer;

			try {
				var result = await this._query('pdf.hasAnnotations', { buf, password }, [buf]);
			}
			catch (e) {
				this._throwWorkerError('pdf.hasAnnotations', e);
			}

			return result.hasAnnotations;
		}, isPriority);
	}
}

Zotero.PDFWorker = new PDFWorker();
