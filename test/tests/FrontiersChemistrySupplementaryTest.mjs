import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(root, 'translators', 'Frontiers.js');
const fixturesPath = path.join(root, 'test', 'tests', 'data', 'frontiers-chemistry-supplementary');

class FixtureNode {
	constructor({tagName = 'DIV', text = '', attrs = {}, children = [], kind = ''} = {}) {
		this.nodeName = tagName;
		this.textContent = text;
		this.attrs = attrs;
		this.children = children;
		this.kind = kind;
		this.parentNode = null;
		for (let child of children) child.parentNode = this;
	}

	getAttribute(name) {
		return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
	}

	querySelector(selector) {
		if (selector === "meta[name='citation_firstpage']") {
			return this.children.find(child => child.kind === 'firstpage') ?? null;
		}
		if (selector.includes("meta[name^='citation_']")) {
			return this.children.find(child => child.kind === 'firstpage') ?? null;
		}
		if (selector.includes('#supplementaryMaterial') || selector.includes('#supplementary-material')
			|| selector.includes('.SupplementalDataV4__list') || selector.includes('.btn-open-supplemental')) {
			return this.kind === 'supplementary' ? this : (this.children.find(child => child.kind === 'supplementary') ?? null);
		}
		return null;
	}

	querySelectorAll(selector) {
		if (selector === 'a[href]') return this.children.filter(child => child.nodeName === 'A');
		if (selector.includes('articleSupplementalData') || selector.includes('.SupplementalDataV4__file')
			|| selector.includes('#supplementary-material')) {
			return this.children.flatMap(child => child.querySelectorAll(selector));
		}
		return [];
	}
}

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

function makeDocument(fixture) {
	let children = [];
	let firstpage = new FixtureNode({
		tagName: 'META',
		attrs: {content: fixture.articleID || ''},
		kind: 'firstpage',
	});
	children.push(firstpage);
	let supplementary = new FixtureNode({kind: fixture.supplementarySection ? 'supplementary' : ''});
	if (fixture.supplementarySection) {
		for (let entry of fixture.supplementarySection.files || []) {
			let filename = new FixtureNode({
				tagName: 'P',
				text: entry.filename || '',
				kind: 'filename',
			});
			let link = new FixtureNode({
				tagName: 'A',
				attrs: {
					href: entry.url,
					'data-event': 'articleSupplementalData-button-download',
				},
			});
			link.querySelector = selector => selector === '.SupplementalDataV4__file__name' ? filename : null;
			let row = new FixtureNode({tagName: 'LI', children: [filename, link], kind: 'file'});
			row.querySelector = selector => selector === '.SupplementalDataV4__file__name' ? filename : null;
			link.parentNode = row;
			supplementary.children.push(row);
		}
		children.push(supplementary);
	}
	for (let href of fixture.unrelatedAnchors || []) {
		children.push(new FixtureNode({tagName: 'A', attrs: {href}}));
	}
	return {
		location: new URL(fixture.url),
		children,
		querySelector(selector) {
			if (selector.includes("meta[name='citation_firstpage']") || selector.includes("meta[name^='citation_']")) {
				return firstpage;
			}
			if (selector.includes('#supplementaryMaterial') || selector.includes('#supplementary-material')
				|| selector.includes('.SupplementalDataV4__list') || selector.includes('.btn-open-supplemental')) {
				return fixture.supplementarySection ? supplementary : null;
			}
			return null;
		},
		querySelectorAll(selector) {
			if (selector === 'a[href]') return children.filter(child => child.nodeName === 'A')
				.concat(supplementary.children.flatMap(row => row.children.filter(child => child.nodeName === 'A')));
			if (selector.includes('articleSupplementalData') || selector.includes('.SupplementalDataV4__file')
				|| selector.includes('#supplementary-material')) {
				return supplementary.children.flatMap(row => row.children.filter(child => child.nodeName === 'A'));
			}
			return [];
		},
	};
}

let source = fs.readFileSync(translatorPath, 'utf8');
source = source.slice(source.indexOf('*/', source.indexOf('/*')) + 2);
source = source.slice(0, source.indexOf('/** BEGIN TEST CASES **/'));

let context = {
	URL,
	ZU: {
		trimInternal: value => String(value).trim().replace(/\s+/g, ' '),
		strToISO: value => value,
		cleanTags: value => String(value).replace(/<[^>]+>/g, ''),
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	attr: (doc, selector, name) => {
		let node = doc.querySelector(selector);
		return node && node.getAttribute(name);
	},
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
	requestCount: 0,
	requestResponse: null,
	requestFailure: null,
};

context.requestJSON = async () => {
	context.requestCount++;
	if (context.requestFailure) throw context.requestFailure;
	return context.requestResponse;
};

let lastItem;
context.Zotero = {
	loadTranslator() {
		let translator = {
			handler: null,
			setTranslator() {},
			setDocument(doc) { this.doc = doc; },
			setHandler(_name, handler) { this.handler = handler; },
			async getTranslatorObject() {
				return {
					async doWeb() {
						let item = {
							itemType: 'journalArticle',
							title: 'Observed Frontiers in Chemistry title',
							DOI: '10.3389/fchem.2021.685783',
							abstractNote: 'Observed abstract',
							creators: [],
							attachments: [{title: 'Full Text PDF', url: 'https://www.frontiersin.org/articles/10.3389/fchem.2021.685783/pdf', mimeType: 'application/pdf'}],
							completeCount: 0,
							complete() { this.completeCount++; lastItem = this; },
						};
						translator.handler(null, item);
					},
				};
			},
		};
		return translator;
	},
	};
context.requestDocument = async () => {
		throw new Error('synthetic optional article-page failure');
};
vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

async function run(name, prefs = {}, api = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.requestCount = 0;
	context.requestResponse = api.response ?? null;
	context.requestFailure = api.failure ?? null;
	context.debugMessages.length = 0;
	lastItem = null;
	await context.doWeb(makeDocument(loadFixture(name)), loadFixture(name).url);
	return {item: lastItem, requestCount: context.requestCount, debugMessages: [...context.debugMessages]};
}

let recent = await run('positive-2021');
assert.equal(recent.requestCount, 0, 'current DOM SI link avoids stale API discovery');
assert.equal(recent.item.completeCount, 1, 'current DOM item completes exactly once');
assert.equal(recent.item.attachments.length, 2, 'current DOM keeps primary PDF and one SI file');
assert.equal(recent.item.attachments[0].mimeType, 'application/pdf', 'primary PDF is preserved');
assert.equal(recent.item.attachments[1].title, 'Supplement - Data Sheet 1.pdf');
assert.equal(recent.item.attachments[1].mimeType, 'application/pdf');
assert.equal(recent.item.attachments[1].snapshot, true);

let current = await run('positive-2025');
assert.equal(current.requestCount, 0, 'second current layout also uses its direct SI link');
assert.equal(current.item.attachments[1].title, 'Supplement - Data Sheet 1.docx');
assert.equal(current.item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.equal(current.item.attachments[1].snapshot, true);

let links = await run('positive-2025', {supplementaryAsLink: true});
assert.equal(links.item.attachments[1].snapshot, false, 'supplementaryAsLink produces a URL-only SI child');
assert.equal(links.item.attachments[1].url, loadFixture('positive-2025').supplementarySection.files[0].url);

let off = await run('positive-2021', {attachSupplementary: false}, {response: {SupplimentalFileDetails: {FileDetails: []}}});
assert.equal(off.requestCount, 0, 'production SI gate makes no discovery request when disabled');
assert.equal(off.item.completeCount, 1, 'SI-off item completes exactly once');
assert.equal(off.item.attachments.length, 1, 'SI-off preserves only the primary PDF');

let noSI = await run('negative-editorial', {}, {response: {SupplimentalFileDetails: {FileDetails: []}}});
assert.equal(noSI.requestCount, 0, 'verified no-SI control makes no API request');
assert.equal(noSI.item.attachments.length, 1, 'verified no-SI control keeps the primary PDF only');

let unrelatedID = await run('article-id-anchor-edge', {}, {response: {
	SupplimentalFileDetails: {FileDetails: [
		{FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/Data_Sheet_1.pdf/685783_supplementary-materials_datasheets_1_pdf/3?signature=article-id'},
	]},
}});
assert.equal(unrelatedID.requestCount, 1, 'missing firstpage uses the current DOI before unrelated article anchors');
assert.equal(unrelatedID.item.attachments.length, 2, 'current article SI is retained despite an unrelated article link');
assert.match(unrelatedID.item.attachments[1].url, /\/articles\/685783\/file\//, 'unrelated article anchor cannot poison the SI article ID');

let apiEdges = await run('api-fallback-edges', {}, {response: {
	SupplimentalFileDetails: {FileDetails: [
		{FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/Data_Sheet_1.pdf/685783_supplementary-materials_datasheets_1_pdf/3?signature=keep-me#fragment'},
		{FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/Data_Sheet_1.pdf/685783_supplementary-materials_datasheets_1_pdf/3?signature=keep-me#fragment'},
		{FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/1682298/file/Data_Sheet_1.docx/1682298_data-sheet_1/1'},
		{FileName: 'molecule.cif', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/molecule.cif/685783_data/1'},
		{FileName: 'model.mzML', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/model.mzML/685783_data/1'},
		{FileName: 'notes.chemdata', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/notes.chemdata/685783_data/1'},
		{FileName: 'run.sh', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/run.sh/685783_data/1'},
		{FileName: 'run.jar', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/run.jar/685783_data/1'},
		{FileName: 'run.com', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/file/run.com/685783_data/1'},
		{FileName: 'secure.pdf', FileDownloadUrl: 'https://user:password@public-pages-files-2025.frontiersin.org/articles/685783/file/secure.pdf/685783_data/1'},
		{FileName: 'port.pdf', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org:443/articles/685783/file/port.pdf/685783_data/1'},
		{FileName: 'viewer.pdf', FileDownloadUrl: 'https://public-pages-files-2025.frontiersin.org/articles/685783/full'},
	]},
}});
assert.equal(apiEdges.requestCount, 1, 'legacy marker uses one bounded API request');
assert.equal(apiEdges.item.completeCount, 1, 'API fallback item completes exactly once');
assert.equal(apiEdges.item.attachments.length, 8, 'API fallback rejects cross-article, credentialed, port, and viewer routes');
assert.equal(apiEdges.item.attachments[1].url.includes('signature=keep-me'), true, 'signed query parameters are preserved');
assert.equal(apiEdges.item.attachments[1].title, 'Supplement - Data_Sheet_1.pdf', 'missing API filename is derived from URL path');
for (let attachment of apiEdges.item.attachments.slice(2)) {
	assert.equal(attachment.snapshot, false, 'unsupported and unknown artifacts remain links');
	assert.equal(Object.hasOwn(attachment, 'mimeType'), false, 'unsupported formats do not get speculative MIME mappings');
}
assert.equal(apiEdges.item.attachments.slice(-3).map(attachment => attachment.title).join('|'),
	'Supplement - run.sh|Supplement - run.jar|Supplement - run.com',
	'unknown code attachments are retained as links without execution');

let failed = await run('api-fallback-edges', {}, {failure: new Error('synthetic malformed API response')});
assert.equal(failed.requestCount, 1, 'API failure is exercised through production scrape');
assert.equal(failed.item.completeCount, 1, 'malformed API failure still completes metadata once');
assert.equal(failed.item.attachments.length, 1, 'malformed API failure preserves primary PDF');
assert.ok(failed.debugMessages.some(message => message.includes('preserving metadata')));

let malformed = await run('api-fallback-edges', {}, {response: {SupplimentalFileDetails: {FileDetails: {not: 'an array'}}}});
assert.equal(malformed.requestCount, 1, 'malformed API shape is exercised through production scrape');
assert.equal(malformed.item.completeCount, 1, 'malformed API shape still completes metadata once');
assert.equal(malformed.item.attachments.length, 1, 'malformed API shape preserves primary PDF');
assert.ok(malformed.debugMessages.some(message => message.includes('preserving metadata')));

console.log('Frontiers in Chemistry supplementary tests passed');
