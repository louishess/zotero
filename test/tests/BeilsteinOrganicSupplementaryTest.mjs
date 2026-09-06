import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(root, 'translators', 'Beilstein Journal of Organic Chemistry.js');
const fixturesPath = path.join(root, 'test', 'tests', 'data', 'beilstein-organic');

class FixtureNode {
	constructor({tagName = 'DIV', text = '', attrs = {}, children = []} = {}) {
		this.nodeName = tagName;
		this.textContent = text;
		this.attrs = attrs;
		this.children = children;
		this.parentNode = null;
		for (let child of children) child.parentNode = this;
	}

	getAttribute(name) {
		return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
	}

	querySelectorAll(selector) {
		let matches = [];
		for (let child of this.children) {
			if (selector === 'a[download][href]'
				&& child.nodeName === 'A'
				&& child.getAttribute('download') !== null
				&& child.getAttribute('href')) {
				matches.push(child);
			}
			matches.push(...child.querySelectorAll(selector));
		}
		return matches;
	}
}

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

function makeDocument(fixture, options = {}) {
	let meta = new Map(Object.entries(fixture.meta || {}));
	let sectionQueries = 0;
	let section = null;
	if (fixture.files) {
		let rows = [];
		for (let file of fixture.files) {
			let labelRow = new FixtureNode({
				tagName: 'TR',
				text: `${file.title}${file.description ? ` ${file.description}` : ''}`,
				children: [new FixtureNode({tagName: 'TD', text: `${file.title}${file.description ? ` ${file.description}` : ''}`})]
			});
			let link = new FixtureNode({
				tagName: 'A',
				text: 'Download',
				attrs: {href: file.href, download: file.download ?? ''},
			});
			let downloadRow = new FixtureNode({
				tagName: 'TR',
				text: `Format: ${file.format || ''} Size: ${file.size || ''}`,
				children: [new FixtureNode({tagName: 'TD', text: `Format: ${file.format || ''}`}), new FixtureNode({tagName: 'TD', children: [new FixtureNode({tagName: 'A', text: 'Download', attrs: {href: file.href, download: file.download ?? ''}})]})],
			});
			// Keep one canonical link in the row used by the production selector.
			downloadRow.children[1] = new FixtureNode({tagName: 'TD', children: [link]});
			downloadRow.children[1].parentNode = downloadRow;
			rows.push(labelRow, downloadRow);
		}
		let tbody = new FixtureNode({tagName: 'TBODY', children: rows});
		let table = new FixtureNode({tagName: 'TABLE', children: [tbody]});
		section = new FixtureNode({tagName: 'DIV', children: [table]});
	}

	let document = {
		location: new URL(fixture.url),
		querySelector(selector) {
			if (selector === '#supporting-info') {
				sectionQueries++;
				return section;
			}
			let metaMatch = selector.match(/^meta\[name="([^"]+)"\]$/);
			if (metaMatch && meta.has(metaMatch[1])) {
				return new FixtureNode({tagName: 'META', attrs: {content: meta.get(metaMatch[1])}});
			}
			return null;
		},
	};
	Object.defineProperty(document, 'sectionQueries', {get: () => sectionQueries});
	if (options.throwSupporting) {
		document.querySelector = new Proxy(document.querySelector, {
			apply(target, thisArg, args) {
				if (args[0] === '#supporting-info') throw new Error('synthetic optional SI failure');
				return Reflect.apply(target, thisArg, args);
			},
		});
	}
	return document;
}

let source = fs.readFileSync(translatorPath, 'utf8');
source = source.slice(source.indexOf('*/', source.indexOf('/*')) + 2);
let context = {
	URL,
	ZU: {trimInternal: value => String(value).trim().replace(/\s+/g, ' ')},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
};
vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

function detect(name, url = null) {
	let fixture = loadFixture(name);
	return context.detectWeb(makeDocument(fixture), url || fixture.url);
}

function extract(name, prefs = {}, options = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	let fixture = loadFixture(name);
	let document = makeDocument(fixture, options);
	let item = {attachments: [{title: 'Full Text PDF', url: fixture.mainPDF, mimeType: 'application/pdf'}]};
	context.attachBeilsteinSupplementary(document, item);
	return {attachments: item.attachments, document};
}

let recent = extract('recent');
assert.equal(recent.attachments.length, 2, 'recent control keeps the main PDF and one SI file');
assert.equal(recent.attachments[1].url, 'https://www.beilstein-journals.org/bjoc/content/supplementary/1860-5397-20-95-S1.pdf');
assert.equal(recent.attachments[1].mimeType, 'application/pdf');
assert.equal(recent.attachments[1].snapshot, true);
assert.match(recent.attachments[1].title, /^Supporting Information File 1:/);

let legacy = extract('legacy');
assert.equal(legacy.attachments.length, 4, 'older control keeps three distinct SI files');
assert.equal(legacy.attachments[1].mimeType, 'application/pdf');
assert.equal(legacy.attachments[2].mimeType, undefined, 'CIF remains an unknown-type link');
assert.equal(legacy.attachments[3].mimeType, undefined, 'second CIF remains an unknown-type link');
assert.notEqual(legacy.attachments[1].url, legacy.attachments[2].url, 'distinct SI URLs remain distinct');
assert.notEqual(legacy.attachments[2].url, legacy.attachments[3].url, 'each older SI URL remains distinct');

let negative = extract('negative-no-si');
assert.equal(negative.attachments.length, 1, 'verified no-SI control adds no attachment');

let missingID = extract('missing-metadata');
assert.equal(missingID.attachments.length, 1, 'missing article identity fails closed for SI');

let links = extract('recent', {supplementaryAsLink: true});
assert.equal(links.attachments[1].snapshot, false, 'link mode preserves the SI URL');
assert.equal(links.attachments[1].mimeType, 'application/pdf');

let edges = extract('edge-cases');
assert.equal(edges.attachments.length, 3, 'edge fixture keeps one valid known file and one unknown file');
assert.equal(edges.attachments[1].url, 'https://www.beilstein-journals.org/bjoc/content/supplementary/1860-5397-20-95-S2.zip?token=keep-me');
assert.equal(edges.attachments[1].mimeType, 'application/zip');
	assert.equal(edges.attachments[2].url, 'https://www.beilstein-journals.org/bjoc/content/supplementary/1860-5397-20-95-S3.bin?download=raw.pdf');
assert.equal(edges.attachments[2].mimeType, undefined, 'query-string extension is not inferred');
assert.equal(edges.attachments[2].snapshot, false, 'unknown type remains a link');

assert.equal(detect('recent'), 'journalArticle', 'Beilstein article is detected as a journal article');
assert.equal(detect('recent', 'https://example.org/bjoc/articles/20/95'), false, 'other hosts are not claimed');
assert.equal(detect('recent', 'https://www.beilstein-journals.org/bjoc/downloads'), false, 'non-article Beilstein pages are not claimed');
assert.equal(detect('recent', 'https://www.beilstein-journals.org/bjoc/articles/20/95/downloads'), false, 'article subpages are not claimed');
assert.equal(detect('recent', 'https://user:pass@www.beilstein-journals.org/bjoc/articles/20/95'), false, 'credentialed URLs are not claimed');
assert.equal(detect('recent', 'https://www.beilstein-journals.org:8443/bjoc/articles/20/95'), false, 'port URLs are not claimed');

let scrapeRun;
context.Zotero = {
	loadTranslator() {
		return {
			setTranslator(id) { assert.equal(id, '951c027d-74ac-47d4-a107-9c3069ab7b48'); },
			setDocument(doc) { this.doc = doc; },
			setHandler(name, handler) { assert.equal(name, 'itemDone'); this.handler = handler; },
			translate() {
				let fixture = scrapeRun.fixture;
				let mainPDF = {title: 'Full Text PDF', url: fixture.mainPDF, mimeType: 'application/pdf', snapshot: true};
				let item = {
					itemType: 'journalArticle', title: fixture.itemTitle, DOI: fixture.doi,
					abstractNote: 'Observed abstract', creators: [], attachments: [mainPDF], completeCount: 0,
					complete() { this.completeCount++; },
				};
				this.handler(null, item);
				scrapeRun.item = item;
				scrapeRun.mainPDF = mainPDF;
			},
		};
	},
};

function runScrape(name, prefs = {}, options = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.debugMessages.length = 0;
	let fixture = loadFixture(name);
	let document = makeDocument(fixture, options);
	scrapeRun = {fixture};
	context.scrape(document, fixture.url);
	scrapeRun.sectionQueries = document.sectionQueries;
	return scrapeRun;
}

let scraped = runScrape('recent');
assert.equal(scraped.item.completeCount, 1, 'EM item completes once after SI extraction');
assert.equal(scraped.item.title, scraped.fixture.itemTitle, 'EM metadata title is preserved');
assert.equal(scraped.item.DOI, scraped.fixture.doi, 'EM DOI is preserved byte-for-byte');
assert.deepEqual(scraped.item.attachments[0], scraped.mainPDF, 'EM main PDF is preserved');
assert.equal(scraped.item.attachments.length, 2, 'full scrape adds SI after the main PDF');
assert.equal(scraped.sectionQueries, 1, 'production scrape performs one bounded DOM SI lookup');

let scrapedOff = runScrape('recent', {attachSupplementary: false});
assert.equal(scrapedOff.item.completeCount, 1, 'EM item completes once with SI disabled');
assert.equal(scrapedOff.item.attachments.length, 1, 'SI-off keeps the main PDF');
assert.equal(scrapedOff.sectionQueries, 0, 'SI-off performs no supplementary DOM lookup');

let scrapedFailure = runScrape('recent', {}, {throwSupporting: true});
assert.equal(scrapedFailure.item.completeCount, 1, 'optional SI failure still completes the EM item once');
assert.equal(scrapedFailure.item.attachments.length, 1, 'optional SI failure leaves the main PDF');
assert.ok(context.debugMessages.some(message => message.includes('Error attaching supplementary')),
	'optional SI failure is reported to translator debug');

console.log('Beilstein Journal of Organic Chemistry supplementary tests passed');
