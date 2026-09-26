import '../../scripts/pdfjs-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import * as pdfWorker from '../../src/pdf/index.js';
import { PDFAssembler } from '../../src/pdf/pdfassembler.js';
import {
	getAnnotationDigest,
	getCanonicalAnnotation,
} from '../../src/pdf/annotations/reconciliation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'pdf', 'full', '1.pdf');
const dataProvider = filename => fs.readFileSync(
	path.join(__dirname, '../../pdf.js/external', filename)
);

function annotation(id, comment = 'A comment') {
	return {
		id,
		type: 'image',
		color: '#F8C348',
		position: { pageIndex: 0, rects: [[100.0004, 100, 180, 112]] },
		authorName: 'Test Author',
		comment,
		pageLabel: '1',
		dateModified: '2026-01-02T03:04:05.000Z',
		tags: ['zeta', 'alpha'],
	};
}

async function subtypeCount(buf, subtype) {
	let pdf = new PDFAssembler();
	await pdf.init(buf);
	let structure = await pdf.getPDFStructure();
	return structure['/Root']['/Pages']['/Kids']
		.flatMap(page => page['/Annots'] || [])
		.filter(value => value['/Subtype'] === subtype).length;
}

async function setRawTombstones(buf, tombstones) {
	let pdf = new PDFAssembler();
	await pdf.init(buf);
	let structure = await pdf.getPDFStructure();
	structure['/Root']['/Zotero:AnnotationTombstones'] = tombstones;
	return pdf.assemblePdf('ArrayBuffer');
}

async function getRawTombstones(buf) {
	let pdf = new PDFAssembler();
	await pdf.init(buf);
	let structure = await pdf.getPDFStructure();
	return structure['/Root']['/Zotero:AnnotationTombstones'] || [];
}

describe('PDF annotation reconciliation metadata', function () {
	it('canonicalizes stable fields deterministically across Desktop and PDF shapes', function () {
		let first = annotation('DIGEST01');
		let second = {
			...first,
			color: '#f8c348',
			position: { pageIndex: 0, rects: [[100, 100, 180, 112.0001]] },
			tags: [{ name: 'alpha' }, { name: 'zeta' }, { name: 'alpha' }],
			dateModified: '2030-09-08T07:06:05.000Z',
		};
		assert.equal(pdfWorker.getAnnotationDigest(first), pdfWorker.getAnnotationDigest(second));
		assert.equal(
			pdfWorker.getAnnotationDigest(first),
			crypto.createHash('sha256')
				.update(JSON.stringify(getCanonicalAnnotation(first)))
				.digest('hex')
		);
		assert.match(pdfWorker.getAnnotationDigest(first), /^[0-9a-f]{64}$/);
		assert.notEqual(
			pdfWorker.getAnnotationDigest(first),
			pdfWorker.getAnnotationDigest({ ...second, comment: 'Changed' })
		);
	});

	it('round-trips identity, base digests, precise sources, and invisible tombstones', async function () {
		let buf = fs.readFileSync(fixturePath);
		let unsupportedLinks = await subtypeCount(buf, '/Link');
		let value = annotation('ROUND001');
		let digest = pdfWorker.getAnnotationDigest(value);
		buf = await pdfWorker.applyAnnotationChanges(buf, {
			upserts: [{ annotation: value, baseDigest: digest }],
			tombstones: {
				upserts: [{
					id: 'DELETED1',
					priorDigest: digest,
					deletionRevision: 7,
					time: '2026-01-02T03:04:05Z',
				}],
			},
		}, undefined, dataProvider);

		let state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		let stored = state.annotations.find(value => value.id === 'ROUND001');
		assert.ok(stored);
		assert.deepEqual(stored.source, {
			type: 'zotero', id: 'ROUND001', pageIndex: 0, occurrence: 0,
		});
		assert.deepEqual(state.sources[state.annotations.indexOf(stored)], stored.source);
		assert.equal(state.digests.ROUND001, digest);
		assert.equal(state.baseDigests.ROUND001, digest);
		assert.deepEqual(state.tombstones, [{
			id: 'DELETED1',
			priorDigest: digest,
			deletionRevision: 7,
			time: '2026-01-02T03:04:05.000Z',
		}]);
		assert.equal(await subtypeCount(buf, '/Link'), unsupportedLinks);

		buf = await pdfWorker.applyAnnotationChanges(buf, {}, undefined, dataProvider);
		state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		assert.equal(state.tombstones[0].id, 'DELETED1');
		buf = await pdfWorker.applyAnnotationChanges(buf, {
			tombstones: { deletions: ['DELETED1'] },
		}, undefined, dataProvider);
		state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		assert.deepEqual(state.tombstones, []);
	});

	it('preserves opaque and forward-compatible tombstones until explicitly targeted', async function () {
		let digest = pdfWorker.getAnnotationDigest(annotation('OPAQUE01'));
		let opaque = {
			'/ID': '(OPAQUE01)',
			'/FutureSchema': '(do-not-drop)',
			num: 0,
			gen: 0,
		};
		let forwardCompatible = {
			'/ID': '(FORWARD1)',
			'/PriorDigest': `(${digest})`,
			'/DeletionRevision': 3,
			'/Time': '(2026-01-02T03:04:05.000Z)',
			'/FutureField': '(keep-me)',
			num: 0,
			gen: 0,
		};
		let buf = await setRawTombstones(fs.readFileSync(fixturePath), [opaque, forwardCompatible]);

		buf = await pdfWorker.applyAnnotationChanges(buf, {
			upserts: [{ annotation: annotation('PRESERVE1') }],
			tombstones: { upserts: [], deletions: [] },
		}, undefined, dataProvider);
		let raw = await getRawTombstones(buf);
		assert.equal(raw.find(value => value['/ID'] === '(OPAQUE01)')['/FutureSchema'], '(do-not-drop)');
		assert.equal(raw.find(value => value['/ID'] === '(FORWARD1)')['/FutureField'], '(keep-me)');

		buf = await pdfWorker.applyAnnotationChanges(buf, {
			tombstones: {
				upserts: [{
					id: 'NEWSTONE',
					priorDigest: digest,
					deletionRevision: 4,
					time: '2026-02-03T04:05:06Z',
				}],
			},
		}, undefined, dataProvider);
		raw = await getRawTombstones(buf);
		assert.equal(raw.find(value => value['/ID'] === '(OPAQUE01)')['/FutureSchema'], '(do-not-drop)');
		assert.equal(raw.find(value => value['/ID'] === '(FORWARD1)')['/FutureField'], '(keep-me)');
		assert.ok(raw.some(value => value['/ID'] === '(NEWSTONE)'));
	});

	it('removes only the requested exact duplicate', async function () {
		let buf = fs.readFileSync(fixturePath);
		let value = annotation('DUPE0001');
		buf = await pdfWorker.writeAnnotations(buf, [value, value], undefined, dataProvider);
		let before = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		let duplicates = before.annotations.filter(value => value.id === 'DUPE0001');
		assert.equal(duplicates.length, 2);
		assert.notDeepEqual(duplicates[0].source, duplicates[1].source);

		buf = await pdfWorker.applyAnnotationChanges(buf, {
			duplicateRemovals: [duplicates[1].source],
		}, undefined, dataProvider);
		let after = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		assert.equal(after.annotations.filter(value => value.id === 'DUPE0001').length, 1);
	});

	it('rotates an identity and returns a locator for the new generation', async function () {
		let buf = fs.readFileSync(fixturePath);
		let value = annotation('OLDID001');
		buf = await pdfWorker.applyAnnotationChanges(buf, {
			upserts: [{ annotation: value }],
		}, undefined, dataProvider);
		let state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		let old = state.annotations.find(value => value.id === 'OLDID001');
		let nextDigest = pdfWorker.getAnnotationDigest({ ...value, id: 'NEWID001' });

		buf = await pdfWorker.applyAnnotationChanges(buf, {
			identityReplacements: [{
				source: old.source,
				id: 'NEWID001',
				baseDigest: nextDigest,
			}],
		}, undefined, dataProvider);
		state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		assert.equal(state.annotations.some(value => value.id === 'OLDID001'), false);
		let replacement = state.annotations.find(value => value.id === 'NEWID001');
		assert.deepEqual(replacement.source, {
			type: 'zotero', id: 'NEWID001', pageIndex: 0, occurrence: 0,
		});
		assert.equal(state.baseDigests.NEWID001, nextDigest);
	});

	it('does not produce output when any requested mutation is invalid', async function () {
		let buf = fs.readFileSync(fixturePath);
		let initial = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		await assert.rejects(pdfWorker.applyAnnotationChanges(buf, {
			upserts: [{ annotation: annotation('ATOMIC01') }],
			deletions: [{ type: 'zotero', id: 'MISSING' }],
		}, undefined, dataProvider), /matched 0 objects/);
		let after = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		assert.deepEqual(after.annotations, initial.annotations);
		assert.deepEqual(after.tombstones, initial.tombstones);
	});

	it('accepts text and page labels re-derived from the PDF page', async function () {
		let value = annotation('VERIFY01');
		value.text = 'reader-side selection text';
		value.pageLabel = 'reader-side page label';
		let buf = await pdfWorker.applyAnnotationChanges(
			fs.readFileSync(fixturePath),
			{ upserts: [{ annotation: value }] },
			undefined,
			dataProvider
		);
		let state = await pdfWorker.readAnnotationState(buf, undefined, dataProvider);
		let stored = state.annotations.find(annotation => annotation.id === value.id);
		assert.ok(stored);
		assert.notEqual(stored.text, value.text);
		assert.notEqual(stored.pageLabel, value.pageLabel);
		assert.equal(state.digests[value.id], getAnnotationDigest(stored));
	});
});
