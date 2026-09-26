import { isTransferable } from './common.js';

/**
 * Delete annotations that are supported and can be imported more or less losslessly
 *
 * @param structure
 * @returns {boolean}
 */
export function deleteAnnotations(structure) {
	return deleteMatchingAnnotations(structure, rawAnnot => isTransferable(rawAnnot));
}

/**
 * Delete annotations matching a predicate, along with popup annotations whose parent is deleted.
 *
 * @param structure
 * @param {Function} predicate
 * @returns {boolean}
 */
export function deleteMatchingAnnotations(structure, predicate) {
	let updated = false;
	for (let pageIndex = 0; pageIndex < structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
		let rawPage = structure['/Root']['/Pages']['/Kids'][pageIndex];
		if (!rawPage['/Annots']) continue;
		let lengthBefore = rawPage['/Annots'].length;
		let matchingRawAnnots = rawPage['/Annots'].filter(predicate);
		rawPage['/Annots'] = rawPage['/Annots'].filter(x => !matchingRawAnnots.includes(x));

		// Delete Popup annotations that have a parent annotation that is being transferred
		rawPage['/Annots'] = rawPage['/Annots'].filter(annot =>
			!(annot['/Subtype'] === '/Popup' && matchingRawAnnots.includes(annot['/Parent']))
		);

		if (!rawPage['/Annots'].length) {
			delete rawPage['/Annots'];
		}

		if (!rawPage['/Annots'] || rawPage['/Annots'].length !== lengthBefore) {
			updated = true;
		}
	}
	return updated;
}
