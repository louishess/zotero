import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const TRANSLATOR = new URL('../../src/zotero/translators/ScienceDirect.js', import.meta.url);
const FIXTURES = new URL('./fixtures/', import.meta.url);

class FixtureElement {
	constructor(tagName, attributes = {}, textContent = '', parentElement = null, baseURL = '') {
		this.nodeName = tagName.toUpperCase();
		this.tagName = this.nodeName;
		this.attributes = attributes;
		this.textContent = textContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
		this.parentElement = parentElement;
		this.firstElementChild = null;
		if (attributes.href) this.href = new URL(attributes.href, baseURL).href;
	}

	getAttribute(name) {
		return this.attributes[name] ?? null;
	}

	querySelector(selector) {
		return selector === 'a[href]' ? this.firstElementChild : null;
	}
}

function attributesFrom(text) {
	let attributes = {};
	for (let match of text.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		attributes[match[1]] = match[2] ?? match[3];
	}
	return attributes;
}

async function fixtureDocument(name, baseURL = 'https://www.sciencedirect.com/science/article/pii/S0040402024000553') {
	let html = await readFile(new URL(name, FIXTURES), 'utf8');
	let containers = [];
	for (let match of html.matchAll(/<(section|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
		let element = new FixtureElement(match[1], attributesFrom(match[2]), match[3], null, baseURL);
		containers.push({ start: match.index, end: match.index + match[0].length, element, innerStart: match.index + match[0].indexOf('>') + 1 });
	}
	let links = [];
	for (let match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		let container = containers
			.filter(candidate => candidate.innerStart <= match.index && match.index < candidate.end)
			.sort((a, b) => (a.end - a.innerStart) - (b.end - b.innerStart))[0];
		let link = new FixtureElement('a', attributesFrom(match[1]), match[2], container?.element ?? null, baseURL);
		if (container) container.element.firstElementChild ||= link;
		links.push(link);
	}
	return {
		location: { href: baseURL },
		querySelector() {
			return null;
		},
		querySelectorAll(selector) {
			return selector === 'a[href]' ? links : [];
		},
		legacySpans: containers
			.filter(container => /^MMCvLABEL_SRC/.test(container.element.getAttribute('class') || ''))
			.map(container => container.element)
	};
}

async function loadTranslator() {
	let code = await readFile(TRANSLATOR, 'utf8');
	code = code.replace(/^\s*{[\s\S]*?}\s*?[\r\n]/, '');
	let context = {
		URL,
		ZU: {
			trimInternal(text) {
				return text.replace(/\s+/g, ' ').trim();
			},
			xpath(doc, expression) {
				return expression.includes('MMCvLABEL_SRC') ? doc.legacySpans : [];
			}
		},
		Z: {
			debug() {},
			getHiddenPref() { return false; }
		},
		Zotero: {
			loadTranslator() {
				throw new Error('test importer not installed');
			},
			debug() {}
		},
		attr() {
			return '';
		},
		text() {
			return '';
		},
		requestDocument: async function () {
			throw new Error('simulated PDF lookup failure');
		}
	};
	context.globalThis = context;
	vm.runInNewContext(code, context, { filename: 'ScienceDirect.js' });
	return context;
}

const RIS = 'TY  - JOUR\nTI  - Tetrahedron fixture citation\nAU  - Doe, Jane\nJO  - Tetrahedron\nPY  - 2024\nER  -\n';

async function runProcessRIS(translator, doc, prefs) {
	let importedItem = {
		itemType: 'journalArticle',
		title: 'Tetrahedron fixture citation',
		creators: [],
		notes: [],
		tags: [],
		attachments: [],
		completeCount: 0,
		complete() {
			this.completeCount++;
		}
	};
	let handler;
	translator.Z.getHiddenPref = key => !!prefs[key];
	translator.Zotero.loadTranslator = function () {
		return {
			setTranslator() {},
			setString() {},
			setHandler(name, callback) {
				assert.equal(name, 'itemDone');
				handler = callback;
			},
			async translate() {
				handler(null, importedItem);
			}
		};
	};
	await translator.processRIS(doc, RIS);
	return importedItem;
}

describe('ScienceDirect Tetrahedron supplementary extraction', function () {
	it('keeps unverified current markup inert and safely extracts verified legacy files', async function () {
		let translator = await loadTranslator();
		let current = await fixtureDocument('sciencedirectTetrahedronCurrent.html');
		// The current block is synthetic saved markup only; live DOM access was
		// unavailable, so it is intentionally not used as an extraction selector.
		let legacy = await fixtureDocument(
			'sciencedirectTetrahedronLegacy.html',
			'https://www.sciencedirect.com/science/article/pii/S004040202400070X'
		);
		let mainPDF = 'https://www.sciencedirect.com/science/article/pii/S0040402024000553/pdfft?download=true';

		let currentFiles = translator.getSupplementaryAttachments(current, false, mainPDF);
		assert.equal(currentFiles.length, 0);

		let legacyFiles = translator.getSupplementaryAttachments(legacy, false);
		assert.equal(legacyFiles.length, 3);
		assert.equal(legacyFiles[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		assert.equal(legacyFiles[0].snapshot, true);
		assert.match(legacyFiles[0].title, /Article plus Supplemental Information/);
		assert.equal(legacyFiles[1].mimeType, 'application/zip');
		assert.equal(legacyFiles[1].snapshot, true);
		assert.equal(legacyFiles[1].url, 'https://ars.els-cdn.com/content/image/1-s2.0-S004040202400070X-mmc7?download=true');
		assert.equal(legacyFiles[2].mimeType, 'application/zip');
		assert.equal(legacyFiles[2].snapshot, true);
	});

	it('preserves numeric archive PIIs and rejects a different article', async function () {
		let translator = await loadTranslator();
		let doc = { location: { href: 'https://www.sciencedirect.com/science/article/pii/0040402082801683' } };
		let pii = translator.getArticlePII(doc);
		assert.equal(pii, '0040402082801683');
		assert.equal(translator.isScienceDirectFileURL('https://ars.els-cdn.com/content/image/1-s2.0-0040402082801683-mmc1.pdf', pii), true);
		assert.equal(translator.isScienceDirectFileURL('https://ars.els-cdn.com/content/image/1-s2.0-0040402082801684-mmc1.pdf', pii), false);
	});

	it('keeps explicit link mode separate and does not replace the primary PDF', async function () {
		let translator = await loadTranslator();
		let legacy = await fixtureDocument(
			'sciencedirectTetrahedronLegacy.html',
			'https://www.sciencedirect.com/science/article/pii/S004040202400070X'
		);
		let files = translator.getSupplementaryAttachments(legacy, true);
		assert.equal(files.length, 3);
		assert.ok(files.every(file => file.snapshot === false));
		assert.equal(files[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		assert.equal(files[1].mimeType, 'application/zip');
		assert.equal(files[2].mimeType, 'application/zip');

		let item = {
			attachments: [{
				title: 'ScienceDirect Full Text PDF',
				url: 'https://www.sciencedirect.com/science/article/pii/S0040402024000553/pdfft?download=true'
			}]
		};
		translator.Z = {
			getHiddenPref() { return false; },
			debug() {}
		};
		translator.attachSupplementary(legacy, item, 'https://www.sciencedirect.com/science/article/pii/S0040402024000553/pdfft?download=true');
		assert.equal(item.attachments.length, 4);
		assert.equal(item.attachments[0].title, 'ScienceDirect Full Text PDF');
		assert.equal(item.attachments[1].title, 'Article plus Supplemental Information');
		assert.equal(item.attachments[2].mimeType, 'application/zip');
		assert.equal(item.attachments[3].mimeType, 'application/zip');
	});

	it('returns no supplementary files for the synthetic no-SI fixture', async function () {
		let translator = await loadTranslator();
		let noSI = await fixtureDocument('sciencedirectTetrahedronNoSI.html');
		assert.equal(translator.getSupplementaryAttachments(noSI, false).length, 0);
	});

	it('completes processRIS after PDF failure with supplementary preferences off', async function () {
		let translator = await loadTranslator();
		let legacy = await fixtureDocument(
			'sciencedirectTetrahedronLegacy.html',
			'https://www.sciencedirect.com/science/article/pii/S004040202400070X'
		);
		let item = await runProcessRIS(translator, legacy, {
			attachSupplementary: false,
			supplementaryAsLink: false
		});
		assert.equal(item.completeCount, 1);
		assert.equal(item.title, 'Tetrahedron fixture citation');
		assert.deepEqual(item.attachments.map(attachment => attachment.title), [
			'ScienceDirect Snapshot'
		]);
	});

	it('completes processRIS after PDF failure and appends verified SI', async function () {
		let translator = await loadTranslator();
		let legacy = await fixtureDocument(
			'sciencedirectTetrahedronLegacy.html',
			'https://www.sciencedirect.com/science/article/pii/S004040202400070X'
		);
		let item = await runProcessRIS(translator, legacy, {
			attachSupplementary: true,
			supplementaryAsLink: false
		});
		assert.equal(item.completeCount, 1);
		assert.deepEqual(item.attachments.map(attachment => attachment.title), [
			'ScienceDirect Snapshot',
			'Article plus Supplemental Information',
			'Supplementary archive',
			'Percent filename'
		]);
		assert.equal(item.attachments[1].snapshot, true);
		assert.equal(item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		assert.equal(item.attachments[2].snapshot, true);
		assert.equal(item.attachments[2].mimeType, 'application/zip');
	});
});
