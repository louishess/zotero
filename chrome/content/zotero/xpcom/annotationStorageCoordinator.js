/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2026 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
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

/**
 * Keep native Zotero annotations and Zotero-keyed PDF annotations consistent.
 *
 * PDF writes are performed before native-item writes. A compact, local-only
 * record in `settings` supplies the three-way merge base and makes an
 * interrupted PDF-first operation repairable on the next reconciliation.
 */
Zotero.AnnotationStorageCoordinator = new function () {
	const SETTING = 'annotationStorageCoordinator';
	const STATE_VERSION = 1;
	const MODE_STANDARD = 'standard';
	const MODE_PDF_ONLY = 'pdf-only';
	const MODE_DUAL = 'pdf-and-zotero';
	const RESOLUTION_PDF = 'pdf';
	const RESOLUTION_ZOTERO = 'zotero';

	let queues = new Map();

	this.reconcile = function (itemID, reason = 'unspecified') {
		return _enqueue(itemID, () => _reconcile(itemID, reason));
	};

	this.applyChanges = function (itemID, changes, expectedState = {}) {
		return _enqueue(itemID, () => _applyChanges(itemID, changes, expectedState));
	};

	this.resolveConflicts = function (itemID, resolutions) {
		return _enqueue(itemID, () => _resolveConflicts(itemID, resolutions));
	};

	// Exposed only to allow focused tests and attachment deletion cleanup.
	this.clearLocalState = async function (itemID) {
		let attachment = await _getAttachment(itemID);
		await Zotero.DB.queryAsync(
			'DELETE FROM settings WHERE setting=? AND key=?',
			[SETTING, _stateKey(attachment)]
		);
	};

	function _enqueue(itemID, task) {
		let previous = queues.get(itemID) || Promise.resolve();
		let promise = previous.catch(() => {}).then(task);
		queues.set(itemID, promise);
		promise.then(() => {
			if (queues.get(itemID) === promise) {
				queues.delete(itemID);
			}
		}, () => {
			if (queues.get(itemID) === promise) {
				queues.delete(itemID);
			}
		});
		return promise;
	}

	async function _reconcile(itemID, reason) {
		let attachment = await _getAttachment(itemID);
		let effectiveMode = await Zotero.PDFWorker.getEffectiveAnnotationStorageMode(attachment);
		let state = await _loadState(attachment);
		let native = await _readNative(attachment);
		let canWritePDF = await Zotero.PDFWorker.canWriteAnnotationsToFile(attachment);
		let pdf = canWritePDF ? await _readPDF(itemID) : null;

		if (state.pending?.conversion) {
			await _resumeConversion(attachment, state, native, pdf);
			state = await _loadState(attachment);
			native = await _readNative(attachment);
			pdf = canWritePDF ? await _readPDF(itemID) : null;
		}

		if (state.pending?.database) {
			await _repairDatabaseFromPDF(attachment, state, pdf);
			state = await _loadState(attachment);
			native = await _readNative(attachment);
		}

		let appliedMode = state.mode || _inferAppliedMode(effectiveMode, native, pdf);
		if (appliedMode !== effectiveMode) {
			if (!canWritePDF) {
				// Unsupported sessions preserve stock Zotero behavior; conversion is
				// deferred until the PDF becomes writable again.
				effectiveMode = MODE_STANDARD;
			}
			else {
				await _convert(attachment, state, appliedMode, effectiveMode, native, pdf);
				state = await _loadState(attachment);
				native = await _readNative(attachment);
				pdf = await _readPDF(itemID);
				appliedMode = state.mode || effectiveMode;
			}
		}

		let result;
		if (effectiveMode === MODE_DUAL && pdf) {
			result = await _reconcileDual(attachment, state, native, pdf);
		}
		else {
			state.mode = appliedMode === effectiveMode ? appliedMode : state.mode;
			await _saveState(attachment, state);
			result = _makeResult(effectiveMode, state.mode || effectiveMode, pdf);
		}
		result.reason = reason;
		return result;
	}

	async function _applyChanges(itemID, changes, expectedState) {
		let attachment = await _getAttachment(itemID);
		let mode = await Zotero.PDFWorker.getEffectiveAnnotationStorageMode(attachment);
		let state = await _loadState(attachment);
		let upserts = (changes.upserts || []).map(entry => _clone(entry.annotation || entry));
		let deletionIDs = (changes.deletions || []).map(entry => (
			typeof entry === 'string' ? entry : entry.id
		));

		if (mode === MODE_STANDARD) {
			await _applyNativeChanges(attachment, upserts, deletionIDs);
			state.mode = MODE_STANDARD;
			await _saveState(attachment, state);
			return _makeResult(mode, MODE_STANDARD, null, { upserts, deletions: deletionIDs });
		}

		let pdf = await _readPDF(itemID);
		let fileState = expectedState.fileToken
			? expectedState
			: { fileToken: pdf.fileToken, fileRevision: pdf.fileRevision };
		let workerChanges = {
			upserts: upserts.map(annotation => ({
				annotation,
				source: pdf.sources[annotation.id],
				baseDigest: state.lastCommon[annotation.id] || pdf.baseDigests[annotation.id]
			})),
			deletions: deletionIDs.map(id => pdf.sources[id]).filter(Boolean),
			tombstones: {
				upserts: deletionIDs.map(id => _makeTombstone(
					id,
					pdf.digests[id] || state.lastCommon[id],
					pdf.fileRevision
				)).filter(Boolean),
				deletions: upserts.map(annotation => annotation.id)
			}
		};
		let written = await _writePDF(itemID, workerChanges, fileState);

		if (mode === MODE_DUAL) {
			state.pending = {
				...state.pending,
				database: {
					upsertIDs: upserts.map(annotation => annotation.id),
					deletionIDs
				}
			};
			await _saveState(attachment, state);
			try {
				await _applyNativeChanges(attachment, upserts, deletionIDs);
				delete state.pending.database;
			}
			catch (e) {
				await _saveState(attachment, state);
				throw e;
			}
		}

		for (let annotation of upserts) {
			let digest = written.digests[annotation.id] || await _digest(annotation);
			state.lastCommon[annotation.id] = digest;
		}
		for (let id of deletionIDs) {
			delete state.lastCommon[id];
		}
		state.mode = mode;
		await _saveState(attachment, state);
		return _makeResult(mode, mode, written, { upserts, deletions: deletionIDs });
	}

	async function _resolveConflicts(itemID, resolutions) {
		if (!Array.isArray(resolutions) && resolutions && typeof resolutions === 'object') {
			resolutions = Object.entries(resolutions).map(([id, value]) => ({
				id,
				choice: typeof value === 'string' ? value : value.choice
			}));
		}
		if (!Array.isArray(resolutions) || !resolutions.length) {
			return { cancelled: true, conflicts: [] };
		}
		let attachment = await _getAttachment(itemID);
		let mode = await Zotero.PDFWorker.getEffectiveAnnotationStorageMode(attachment);
		if (mode !== MODE_DUAL) {
			throw new Error('Annotation conflicts can only be resolved in dual storage mode');
		}
		let state = await _loadState(attachment);
		let pdf = await _readPDF(itemID);
		let native = await _readNative(attachment);
		let upserts = [];
		let deletions = [];
		let nativeUpserts = [];
		let nativeDeletions = [];
		let tombstoneUpserts = [];
		let tombstoneDeletions = [];
		let duplicateRemovals = [];

		for (let resolution of resolutions) {
			if (![RESOLUTION_PDF, RESOLUTION_ZOTERO].includes(resolution.choice)) {
				throw new Error(`Invalid annotation conflict resolution '${resolution.choice}'`);
			}
			let id = resolution.id;
			let duplicateEntries = pdf.duplicateConflicts[id] || [];
			if (resolution.choice === RESOLUTION_PDF) {
				if (pdf.byID[id]) {
					nativeUpserts.push(pdf.byID[id]);
					tombstoneDeletions.push(id);
					// The first PDF copy is the version shown in the conflict dialog.
					// Keep it and remove every other source with the same ID.
					duplicateRemovals.push(...duplicateEntries.slice(1).map(x => x.source));
				}
				else {
					nativeDeletions.push(id);
					tombstoneUpserts.push(_makeTombstone(
						id,
						state.lastCommon[id] || native.digests[id] || null,
						pdf.fileRevision
					));
				}
			}
			else {
				if (native.byID[id]) {
					tombstoneDeletions.push(id);
					// Remove all conflicting PDF copies before writing one canonical
					// version from Zotero.
					duplicateRemovals.push(...duplicateEntries.map(x => x.source));
					upserts.push({
						annotation: native.byID[id],
						source: duplicateEntries.length ? undefined : pdf.sources[id],
						baseDigest: state.lastCommon[id]
					});
					nativeUpserts.push(native.byID[id]);
				}
				else if (pdf.sources[id]) {
					deletions.push(pdf.sources[id]);
					nativeDeletions.push(id);
					tombstoneUpserts.push(_makeTombstone(
						id,
						pdf.digests[id] || state.lastCommon[id] || null,
						pdf.fileRevision
					));
				}
			}
		}

		let written = pdf;
		if (upserts.length || deletions.length || tombstoneUpserts.length
			|| tombstoneDeletions.length
			|| duplicateRemovals.length) {
			written = await _writePDF(itemID, {
				upserts,
				deletions,
				duplicateRemovals: duplicateRemovals.filter(Boolean),
				tombstones: {
					upserts: tombstoneUpserts.filter(Boolean),
					deletions: tombstoneDeletions
				}
			}, pdf);
		}
		state.pending = {
			...state.pending,
			database: {
				upsertIDs: nativeUpserts.map(x => x.id),
				deletionIDs: nativeDeletions
			}
		};
		await _saveState(attachment, state);
		await _applyNativeChanges(attachment, nativeUpserts, nativeDeletions);
		delete state.pending.database;
		let refreshed = await _readPDF(itemID);
		let refreshedNative = await _readNative(attachment);
		_updateCommonState(state, refreshed, refreshedNative);
		await _saveState(attachment, state);
		return _makeResult(mode, mode, refreshed, {
			upserts: nativeUpserts,
			deletions: nativeDeletions,
			resolved: resolutions.map(x => x.id)
		});
	}

	async function _reconcileDual(attachment, state, native, pdf) {
		let pdfUpserts = [];
		let pdfDeletions = [];
		let tombstoneUpserts = [];
		let nativeUpserts = [];
		let nativeDeletions = [];
		let conflicts = [];
		let tombstones = new Map(pdf.tombstones.map(x => [x.id, x]));
		let ids = new Set([...Object.keys(pdf.byID), ...Object.keys(native.byID), ...tombstones.keys()]);
		let duplicateConflicts = new Set(Object.keys(pdf.duplicateConflicts));
		for (let [id, entries] of Object.entries(pdf.duplicateConflicts)) {
			let annotations = entries.map(x => x.annotation);
				conflicts.push({
					..._conflict(
						'duplicate-pdf-id',
						id,
						annotations[0],
						native.byID[id] || null,
						state.lastCommon[id] || pdf.baseDigests[id]
					),
				pdfDuplicates: annotations.map(_clone)
			});
		}

		for (let id of ids) {
			if (duplicateConflicts.has(id)) continue;
			let pdfAnnotation = pdf.byID[id];
			let nativeAnnotation = native.byID[id];
			let pdfDigest = pdf.digests[id];
			let nativeDigest = native.digests[id];
			let common = state.lastCommon[id] || pdf.baseDigests[id];
			let tombstone = tombstones.get(id);

			if (tombstone) {
				let pdfIsStale = !pdfAnnotation || pdfDigest === tombstone.priorDigest;
				let nativeIsStale = !nativeAnnotation || nativeDigest === tombstone.priorDigest;
				if (!pdfIsStale || !nativeIsStale) {
					conflicts.push(_conflict(
						'deletion-vs-edit',
						id,
						pdfAnnotation,
						nativeAnnotation,
						tombstone.priorDigest
					));
					continue;
				}
				if (pdfAnnotation && pdf.sources[id]) pdfDeletions.push(pdf.sources[id]);
				if (nativeAnnotation) nativeDeletions.push(id);
				delete state.lastCommon[id];
				continue;
			}

			if (pdfAnnotation && nativeAnnotation) {
				if (pdfDigest === nativeDigest) {
					state.lastCommon[id] = pdfDigest;
					continue;
				}
				if (common && pdfDigest === common && nativeDigest !== common) {
					pdfUpserts.push({
						annotation: nativeAnnotation,
						source: pdf.sources[id],
						baseDigest: common
					});
					continue;
				}
				if (common && nativeDigest === common && pdfDigest !== common) {
					nativeUpserts.push(pdfAnnotation);
					continue;
				}
				conflicts.push(_conflict('both-modified', id, pdfAnnotation, nativeAnnotation, common));
				continue;
			}

			if (pdfAnnotation) {
				if (common) {
					if (pdfDigest === common) {
						pdfDeletions.push(pdf.sources[id]);
						tombstoneUpserts.push(_makeTombstone(id, pdfDigest, pdf.fileRevision));
					}
					else {
						conflicts.push(_conflict('zotero-deleted-pdf-modified', id, pdfAnnotation, null, common));
					}
				}
				else if (_isTrustedPDFAnnotation(pdfAnnotation, pdf.sources[id])) {
					nativeUpserts.push(pdfAnnotation);
				}
				else {
					conflicts.push(_conflict('unknown-pdf-only', id, pdfAnnotation, null, null));
				}
				continue;
			}

			if (nativeAnnotation) {
				if (common) {
					conflicts.push(_conflict('pdf-deleted-without-tombstone', id, null, nativeAnnotation, common));
				}
				else {
					pdfUpserts.push({ annotation: nativeAnnotation });
				}
			}
		}

		let changedPDF = pdf;
		if (pdfUpserts.length || pdfDeletions.filter(Boolean).length
			|| tombstoneUpserts.length || pdf.duplicateRemovals.length) {
			changedPDF = await _writePDF(attachment.id, {
				upserts: pdfUpserts,
				deletions: pdfDeletions.filter(Boolean),
				duplicateRemovals: pdf.duplicateRemovals,
				tombstones: { upserts: tombstoneUpserts.filter(Boolean), deletions: [] }
			}, pdf);
		}
		if (nativeUpserts.length || nativeDeletions.length) {
			state.pending = {
				...state.pending,
				database: {
					upsertIDs: nativeUpserts.map(x => x.id),
					deletionIDs: nativeDeletions
				}
			};
			await _saveState(attachment, state);
			await _applyNativeChanges(attachment, nativeUpserts, nativeDeletions);
			delete state.pending.database;
		}

		if (pdfUpserts.length || pdfDeletions.length || nativeUpserts.length || nativeDeletions.length) {
			changedPDF = await _readPDF(attachment.id);
			native = await _readNative(attachment);
		}
		_updateCommonState(state, changedPDF, native);
		state.mode = MODE_DUAL;
		await _saveState(attachment, state);
		return _makeResult(MODE_DUAL, MODE_DUAL, changedPDF, {
			upserts: [...pdfUpserts.map(x => x.annotation), ...nativeUpserts],
			deletions: [...nativeDeletions],
			conflicts
		});
	}

	async function _convert(attachment, state, from, to, native, pdf) {
		Zotero.debug(`Converting annotation storage for item ${attachment.id}: ${from} -> ${to}`);
		if (to === MODE_PDF_ONLY && from !== MODE_PDF_ONLY) {
			await _convertToPDFOnly(attachment, state, from, native, pdf);
			return;
		}
		if (from === MODE_PDF_ONLY && to === MODE_DUAL) {
			await _createNativeFromPDF(attachment, state, pdf, MODE_DUAL);
			return;
		}
		if (from === MODE_PDF_ONLY && to === MODE_STANDARD) {
			await _convertPDFOnlyToStandard(attachment, state, pdf);
			return;
		}
		if (from === MODE_STANDARD && to === MODE_DUAL) {
			let upserts = Object.values(native.byID).map(annotation => ({ annotation }));
			if (upserts.length) await _writePDF(attachment.id, { upserts }, pdf);
			state.mode = MODE_DUAL;
			_updateCommonState(state, await _readPDF(attachment.id), native);
			await _saveState(attachment, state);
			return;
		}
		if (from === MODE_DUAL && to === MODE_STANDARD) {
			await _removeMirroredPDF(attachment, state, native, pdf, MODE_STANDARD);
			return;
		}
		state.mode = to;
		await _saveState(attachment, state);
	}

	async function _convertToPDFOnly(attachment, state, from, native, pdf) {
		let rotations = [];
		for (let oldID of Object.keys(native.byID)) {
			let newID;
			do {
				newID = Zotero.DataObjectUtilities.generateKey();
			}
			while (await _isDeletedItemKey(attachment.libraryID, newID));
			rotations.push({ oldID, newID, source: pdf.sources[oldID] || null });
		}
		state.pending = {
			...state.pending,
			conversion: { from, to: MODE_PDF_ONLY, phase: 'prepared', rotations }
		};
		await _saveState(attachment, state);
		await _resumeConversion(attachment, state, native, pdf);
	}

	async function _resumeConversion(attachment, state, native, pdf) {
		let conversion = state.pending.conversion;
		if (conversion.to === MODE_STANDARD) {
			await _resumePDFOnlyToStandard(attachment, state, pdf);
			return;
		}
		if (conversion.to !== MODE_PDF_ONLY) {
			throw new Error(`Unsupported pending annotation conversion to '${conversion.to}'`);
		}
		if (!pdf) pdf = await _readPDF(attachment.id);
		if (conversion.phase === 'prepared') {
			let newIDs = new Set(Object.keys(pdf.byID));
			if (!conversion.rotations.every(x => newIDs.has(x.newID))) {
				let identityReplacements = [];
				let upserts = [];
				for (let rotation of conversion.rotations) {
					let annotation = native.byID[rotation.oldID];
					if (!annotation) continue;
					if (rotation.source || pdf.sources[rotation.oldID]) {
						identityReplacements.push({
							source: rotation.source || pdf.sources[rotation.oldID],
							id: rotation.newID
						});
					}
					else {
						upserts.push({ annotation: { ...annotation, id: rotation.newID } });
					}
				}
				await _writePDF(attachment.id, { identityReplacements, upserts }, pdf);
				pdf = await _readPDF(attachment.id);
				let missing = conversion.rotations.filter(x => !pdf.byID[x.newID]);
				if (missing.length) {
					throw new Error(`Failed to verify rotated PDF annotation IDs: ${missing.map(x => x.newID).join(', ')}`);
				}
			}
			conversion.phase = 'pdf-written';
			await _saveState(attachment, state);
		}
		if (conversion.phase === 'pdf-written') {
			for (let rotation of conversion.rotations) {
				let item = Zotero.Items.getByLibraryAndKey(attachment.libraryID, rotation.oldID);
				if (item?.isAnnotation() && item.parentID === attachment.id) {
					await item.eraseTx();
				}
				delete state.lastCommon[rotation.oldID];
			}
			state.mode = MODE_PDF_ONLY;
			delete state.pending.conversion;
			await _saveState(attachment, state);
		}
	}

	async function _convertPDFOnlyToStandard(attachment, state, pdf) {
		let annotationIDs = Object.values(pdf.byID)
			.filter(annotation => _isTrustedPDFAnnotation(annotation, pdf.sources[annotation.id]))
			.map(annotation => annotation.id);
		state.pending = {
			...state.pending,
			conversion: {
				from: MODE_PDF_ONLY,
				to: MODE_STANDARD,
				phase: 'create-native',
				annotationIDs
			}
		};
		await _saveState(attachment, state);
		await _resumePDFOnlyToStandard(attachment, state, pdf);
	}

	async function _resumePDFOnlyToStandard(attachment, state, pdf) {
		let conversion = state.pending.conversion;
		if (!pdf) pdf = await _readPDF(attachment.id);
		if (conversion.phase === 'create-native') {
			let annotations = conversion.annotationIDs.map(id => pdf.byID[id]).filter(Boolean);
			for (let annotation of annotations) {
				if (await _isDeletedItemKey(attachment.libraryID, annotation.id)) {
					throw new Error(`Refusing to recreate deleted Zotero annotation key '${annotation.id}'`);
				}
			}
			await _applyNativeChanges(attachment, annotations, []);
			let native = await _readNative(attachment);
			let missing = conversion.annotationIDs.filter(id => !native.byID[id]);
			if (missing.length) {
				throw new Error(`Failed to verify native annotation copies: ${missing.join(', ')}`);
			}
			conversion.phase = 'native-written';
			await _saveState(attachment, state);
		}
		if (conversion.phase === 'native-written') {
			// Re-read to tolerate a crash after the PDF write but before the final
			// local-state update. Missing sources are already successfully removed.
			pdf = await _readPDF(attachment.id);
			let sources = conversion.annotationIDs.map(id => pdf.sources[id]).filter(Boolean);
			if (sources.length) {
				await _writePDF(attachment.id, { deletions: sources }, pdf);
				pdf = await _readPDF(attachment.id);
			}
			let remaining = conversion.annotationIDs.filter(id => pdf.byID[id]);
			if (remaining.length) {
				throw new Error(`Failed to remove mirrored PDF annotations: ${remaining.join(', ')}`);
			}
			state.mode = MODE_STANDARD;
			state.lastCommon = {};
			delete state.pending.conversion;
			await _saveState(attachment, state);
		}
	}

	async function _createNativeFromPDF(attachment, state, pdf, targetMode) {
		let annotations = Object.values(pdf.byID).filter(annotation => (
			_isTrustedPDFAnnotation(annotation, pdf.sources[annotation.id])
		));
		for (let annotation of annotations) {
			if (await _isDeletedItemKey(attachment.libraryID, annotation.id)) {
				throw new Error(`Refusing to recreate deleted Zotero annotation key '${annotation.id}'`);
			}
		}
		state.pending = {
			...state.pending,
			database: { upsertIDs: annotations.map(x => x.id), deletionIDs: [] }
		};
		await _saveState(attachment, state);
		await _applyNativeChanges(attachment, annotations, []);
		delete state.pending.database;
		state.mode = targetMode;
		if (targetMode === MODE_DUAL) {
			let native = await _readNative(attachment);
			_updateCommonState(state, pdf, native);
		}
		await _saveState(attachment, state);
	}

	async function _removeMirroredPDF(attachment, state, native, pdf, targetMode) {
		let sources = Object.keys(native.byID).map(id => pdf.sources[id]).filter(Boolean);
		if (sources.length) {
			await _writePDF(attachment.id, { deletions: sources }, pdf);
			let verified = await _readPDF(attachment.id);
			let remaining = Object.keys(native.byID).filter(id => verified.byID[id]);
			if (remaining.length) {
				throw new Error(`Failed to remove mirrored PDF annotations: ${remaining.join(', ')}`);
			}
		}
		state.mode = targetMode;
		state.lastCommon = {};
		await _saveState(attachment, state);
	}

	async function _repairDatabaseFromPDF(attachment, state, pdf) {
		if (!pdf) pdf = await _readPDF(attachment.id);
		let pending = state.pending.database;
		let upserts = pending.upsertIDs.map(id => pdf.byID[id]).filter(Boolean);
		await _applyNativeChanges(attachment, upserts, pending.deletionIDs || []);
		delete state.pending.database;
		await _saveState(attachment, state);
	}

	async function _applyNativeChanges(attachment, upserts, deletionIDs) {
		let notifierQueue = new Zotero.Notifier.Queue();
		try {
			for (let annotation of upserts) {
				let json = _clone(annotation);
				json.key = json.id || json.key;
				delete json.id;
				json.isExternal = false;
				await Zotero.Annotations.saveFromJSON(attachment, json, {
					notifierQueue,
					notifierData: { annotationStorageCoordinator: true }
				});
			}
			for (let id of deletionIDs) {
				let item = Zotero.Items.getByLibraryAndKey(attachment.libraryID, id);
				if (item?.isAnnotation() && item.parentID === attachment.id) {
					await item.eraseTx({
						notifierQueue,
						notifierData: { annotationStorageCoordinator: true }
					});
				}
			}
		}
		finally {
			await Zotero.Notifier.commit(notifierQueue);
		}
	}

	async function _readNative(attachment) {
		let byID = {};
		let digests = {};
		for (let item of attachment.getAnnotations().filter(x => !x.annotationIsExternal)) {
			let annotation = await Zotero.Annotations.toJSON(item);
			annotation.id = item.key;
			delete annotation.key;
			byID[item.key] = annotation;
			digests[item.key] = await _digest(annotation);
		}
		return { byID, digests };
	}

	async function _readPDF(itemID) {
		let pdf = _normalizePDFResult(await Zotero.PDFWorker.readAnnotations(itemID, true));
		for (let [id, entries] of Object.entries(pdf.duplicateGroups)) {
			let digests = await Promise.all(entries.map(entry => _digest(entry.annotation)));
			if (new Set(digests).size === 1) {
				pdf.duplicateRemovals.push(...entries.slice(1).map(entry => entry.source));
			}
			else {
				pdf.duplicateConflicts[id] = entries;
			}
		}
		return pdf;
	}

	async function _writePDF(itemID, changes, expected) {
		let expectedState = {
			fileToken: expected.fileToken,
			fileRevision: expected.fileRevision
		};
		let result = await Zotero.PDFWorker.applyAnnotationChanges(
			itemID,
			changes,
			expectedState,
			true
		);
		// New worker results contain the verified post-write snapshot. Re-read
		// when running against an older manager so coordinator semantics stay the same.
		if (!result.annotations || !result.digests) {
			return _readPDF(itemID);
		}
		return _normalizePDFResult(result);
	}

	function _normalizePDFResult(result) {
		let byID = {};
		let sources = {};
		let duplicateGroups = {};
		let displayAnnotations = [];
		let resultSources = result.sources || [];
		for (let i = 0; i < (result.annotations || []).length; i++) {
			let annotation = result.annotations[i];
			let source = annotation.source || (Array.isArray(resultSources)
				? resultSources[i]
				: resultSources[annotation.id]);
			let cleanAnnotation = _clone(annotation);
			if (source) cleanAnnotation.source = _clone(source);
			displayAnnotations.push(cleanAnnotation);
			if (!annotation.id) continue;
			if (byID[annotation.id]) {
				duplicateGroups[annotation.id] ||= [{
					annotation: byID[annotation.id],
					source: sources[annotation.id]
				}];
				duplicateGroups[annotation.id].push({ annotation: cleanAnnotation, source: _clone(source) });
				continue;
			}
			byID[annotation.id] = cleanAnnotation;
			if (source) sources[annotation.id] = _clone(source);
		}
		return {
			...result,
			byID,
			sources,
			displayAnnotations,
			duplicateGroups,
			duplicateRemovals: [],
			duplicateConflicts: {},
			digests: { ...(result.digests || {}) },
			baseDigests: { ...(result.baseDigests || {}) },
			tombstones: Array.isArray(result.tombstones)
				? result.tombstones.map(_clone)
				: Object.values(result.tombstones || {}).map(_clone)
		};
	}

	async function _digest(annotation) {
		if (Zotero.PDFWorker.getAnnotationDigest) {
			return Zotero.PDFWorker.getAnnotationDigest(annotation);
		}
		// Compatibility while the worker protocol branch is not present. This
		// value is local-only and is replaced by worker digests after a PDF write.
		let stable = {};
		for (let key of ['id', 'type', 'position', 'text', 'comment', 'color', 'tags',
			'pageLabel', 'authorName']) {
			stable[key] = annotation[key] ?? null;
		}
		return Zotero.Utilities.Internal.sha1(JSON.stringify(stable));
	}

	async function _getAttachment(itemID) {
		let attachment = await Zotero.Items.getAsync(itemID);
		if (!attachment?.isPDFAttachment()) {
			throw new Error('Item must be a PDF attachment');
		}
		return attachment;
	}

	function _stateKey(attachment) {
		return `${attachment.libraryID}/${attachment.key}`;
	}

	async function _loadState(attachment) {
		let value = await Zotero.DB.valueQueryAsync(
			'SELECT value FROM settings WHERE setting=? AND key=?',
			[SETTING, _stateKey(attachment)]
		);
		let state;
		try {
			state = value ? JSON.parse(value) : {};
		}
		catch (e) {
			Zotero.logError(e);
			state = {};
		}
		return {
			version: STATE_VERSION,
			mode: state.version === STATE_VERSION ? state.mode || null : null,
			lastCommon: state.version === STATE_VERSION ? state.lastCommon || {} : {},
			pending: state.version === STATE_VERSION ? state.pending || {} : {}
		};
	}

	async function _saveState(attachment, state) {
		let compact = {
			version: STATE_VERSION,
			mode: state.mode || null,
			lastCommon: state.lastCommon || {},
			pending: state.pending || {}
		};
		await Zotero.DB.queryAsync(
			'REPLACE INTO settings (setting, key, value) VALUES (?, ?, ?)',
			[SETTING, _stateKey(attachment), JSON.stringify(compact)]
		);
	}

	async function _isDeletedItemKey(libraryID, key) {
		return !!(await Zotero.DB.valueQueryAsync(
			'SELECT 1 FROM syncDeleteLog D JOIN syncObjectTypes T USING (syncObjectTypeID) '
				+ "WHERE D.libraryID=? AND D.key=? AND T.name='item' LIMIT 1",
			[libraryID, key]
		));
	}

	function _inferAppliedMode(target, native, pdf) {
		let hasNative = Object.keys(native.byID).length > 0;
		let hasPDF = !!pdf && Object.values(pdf.byID).some(annotation => (
			_isTrustedPDFAnnotation(annotation, pdf.sources[annotation.id])
		));
		if (hasNative && hasPDF) return MODE_DUAL;
		if (hasNative) return MODE_STANDARD;
		if (hasPDF) return MODE_PDF_ONLY;
		return target;
	}

	function _updateCommonState(state, pdf, native) {
		for (let id of new Set([...Object.keys(pdf.byID), ...Object.keys(native.byID)])) {
			if (pdf.digests[id] && pdf.digests[id] === native.digests[id]) {
				state.lastCommon[id] = pdf.digests[id];
			}
		}
		for (let id of Object.keys(state.lastCommon)) {
			if (!pdf.byID[id] && !native.byID[id]) delete state.lastCommon[id];
		}
	}

	function _isTrustedPDFAnnotation(annotation, source) {
		return !!annotation.id && (source?.type === 'zotero' || source?.id === annotation.id);
	}

	function _makeTombstone(id, priorDigest, fileRevision) {
		if (!priorDigest) return null;
		return {
			id,
			priorDigest,
			deletionRevision: (fileRevision || 0) + 1,
			time: new Date().toISOString()
		};
	}

	function _conflict(type, id, pdf, zotero, baseDigest) {
		return { type, id, pdf: pdf ? _clone(pdf) : null, zotero: zotero ? _clone(zotero) : null, baseDigest };
	}

	function _makeResult(effectiveMode, appliedMode, pdf, extra = {}) {
		return {
			effectiveMode,
			appliedMode,
			annotations: pdf
				? (effectiveMode === MODE_PDF_ONLY
					? pdf.displayAnnotations
					: Object.values(pdf.byID)).map(_clone)
				: [],
			fileToken: pdf?.fileToken || null,
			fileRevision: pdf?.fileRevision || null,
			sources: pdf ? _clone(pdf.sources) : {},
			pendingRepairs: extra.pendingRepairs || [],
			verifiedChanges: {
				upserts: extra.upserts || [],
				deletions: extra.deletions || []
			},
			conflicts: extra.conflicts || [],
			resolved: extra.resolved || []
		};
	}

	function _clone(value) {
		return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
	}
};
