import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(root, 'translators', 'MDPI Journals.js');
const fixturesPath = path.join(root, 'test', 'tests', 'data', 'mdpi-materials-supplementary');

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

	querySelector(selector) {
		if (selector === 'b') return this.children.find(child => child.nodeName === 'B') ?? null;
		if (selector === '#supplementaryModal') return this.id === 'supplementaryModal' ? this : null;
		return null;
	}

	querySelectorAll(selector) {
		if (selector !== 'a[href]') return [];
		return this.children.flatMap(child => child.nodeName === 'A' && child.getAttribute('href')
			? [child]
			: child.querySelectorAll(selector));
	}
}

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

function makeDocument(fixture, options = {}) {
	let entries = fixture.entries.map(entry => {
		let heading = new FixtureNode({tagName: 'B', text: entry.heading});
		let link = new FixtureNode({
			tagName: 'A',
			text: entry.text,
			attrs: {href: entry.href, ...(entry.download ? {download: entry.download} : {})}
		});
		// Match the live MDPI shape: the download anchor is nested in a
		// paragraph inside the list item headed by the file label.
		let paragraph = new FixtureNode({tagName: 'P', text: entry.entryText, children: [link]});
		return new FixtureNode({
			tagName: 'LI',
			text: entry.entryText,
			children: [heading, paragraph]
		});
	});
	let modal = fixture.hasModal === false ? null : new FixtureNode({tagName: 'DIV', children: entries});
	if (modal) modal.id = 'supplementaryModal';
	let supplementaryQueries = 0;
	let document = {
		location: new URL(fixture.url),
		querySelector(selector) {
			if (selector === '#supplementaryModal') supplementaryQueries++;
			if (options.throwSupplementary && selector === '#supplementaryModal') {
				throw new Error('synthetic optional SI failure');
			}
			return selector === '#supplementaryModal' ? modal : null;
		},
	};
	Object.defineProperty(document, 'supplementaryQueries', {get() { return supplementaryQueries; }});
	return document;
}

let source = fs.readFileSync(translatorPath, 'utf8');
source = source.slice(source.indexOf('*/', source.indexOf('/*')) + 2);
source = source.slice(0, source.indexOf('/** BEGIN TEST CASES **/'));
let context = {
	URL,
	ZU: {
		trimInternal: value => String(value).trim().replace(/\s+/g, ' '),
		cleanISSN: () => '1996-1944',
		cleanAuthor: value => value,
		xpath: () => [],
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
	DOMParser: class {
		parseFromString(value) {
			return {documentElement: {textContent: String(value)}};
		}
	},
	attr: () => '',
};
vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

function extract(name, prefs = {}, documentOptions = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	let fixture = loadFixture(name);
	let item = {attachments: [{title: 'Full Text PDF', mimeType: 'application/pdf', url: `${fixture.url}/pdf`}]};
	context.attachMDPISupplementary(makeDocument(fixture, documentOptions), item);
	return item.attachments;
}

let scrapeRun;
context.Zotero = {
	loadTranslator() {
		let translator = {
			handler: null,
			setTranslator(id) {
				assert.equal(id, '951c027d-74ac-47d4-a107-9c3069ab7b48');
			},
			setDocument(doc) {
				this.doc = doc;
			},
			setHandler(name, handler) {
				assert.equal(name, 'itemDone');
				this.handler = handler;
			},
			translate() {
				let mainPDF = {
					title: 'Full Text PDF',
					url: `${scrapeRun.fixture.url}/pdf?version=main`,
					mimeType: 'application/pdf',
					snapshot: true,
				};
				let item = {
					itemType: 'journalArticle',
					title: 'Observed Materials title',
					DOI: '10.3390/ma19163558',
					abstractNote: 'Observed abstract',
					creators: [],
					attachments: [mainPDF],
					completeCount: 0,
					complete() {
						this.completeCount++;
					},
				};
				this.handler(null, item);
				scrapeRun.item = item;
				scrapeRun.mainPDF = mainPDF;
			},
		};
		return translator;
	},
};

function runScrape(name, prefs = {}, documentOptions = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.debugMessages.length = 0;
	let fixture = loadFixture(name);
	let document = makeDocument(fixture, documentOptions);
	scrapeRun = {fixture};
	context.scrape(document, fixture.url);
	scrapeRun.supplementaryQueries = document.supplementaryQueries;
	return scrapeRun;
}

let recent = extract('recent');
assert.equal(recent.length, 2, 'recent Materials control keeps the main PDF and one SI file');
assert.equal(recent[1].url, 'https://www.mdpi.com/1996-1944/19/16/3558/s1?version=1787318969');
assert.equal(recent[1].mimeType, 'application/zip');
assert.equal(recent[1].snapshot, true);
assert.equal(recent[1].title, 'Supplementary File 1: ZIP-Document');

let legacy = extract('legacy');
assert.equal(legacy.length, 2, 'older Materials control keeps the supplementary PDF');
assert.equal(legacy[1].url, 'https://www.mdpi.com/1996-1944/10/1/86/s1?version=1484984785');
assert.equal(legacy[1].mimeType, 'application/pdf');
assert.equal(legacy[1].snapshot, true);

let negative = extract('negative-no-si');
assert.equal(negative.length, 1, 'verified no-SI Materials control adds no attachment');
assert.equal(makeDocument(loadFixture('negative-no-si')).querySelector('#supplementaryModal'), null);

let links = extract('recent', {supplementaryAsLink: true});
assert.equal(links[1].snapshot, false, 'link mode preserves the SI URL');
assert.equal(links[1].mimeType, 'application/zip');

let edges = extract('edge-cases');
assert.equal(edges.length, 7, 'edge fixture keeps six article-scoped SI descriptors');
assert.equal(edges[1].title, 'Supplementary File 1: same.zip');
assert.equal(edges[2].title, 'Supplementary File 2: same.zip');
assert.notEqual(edges[1].url, edges[2].url, 'same filename does not merge distinct URLs');
assert.equal(edges[3].url, 'https://www.mdpi.com/1996-1944/19/16/3558/s3?download=raw.pdf&signature=keep-me');
assert.equal(edges[3].mimeType, undefined, 'query-string extension is not inferred');
assert.equal(edges[3].snapshot, false, 'unknown binary remains a link');
assert.equal(edges[4].mimeType, undefined, 'CIF remains a link');
assert.equal(edges[5].mimeType, undefined, 'mzML remains a link');
assert.equal(edges[6].url, 'https://www.mdpi.com/1996-1944/19/16/3558/s6?version=relative');
assert.ok(edges.every(attachment => !attachment.url?.includes('/1996-1944/19/16/3559/s1')),
	'cross-article supplementary route is rejected');

let scraped = runScrape('recent');
assert.equal(scraped.item.completeCount, 1, 'EM item completes once after supplementary extraction');
assert.equal(scraped.item.title, 'Observed Materials title', 'EM metadata title is preserved');
assert.equal(scraped.item.DOI, '10.3390/ma19163558', 'EM metadata DOI is preserved');
assert.equal(scraped.item.abstractNote, 'Observed abstract', 'EM metadata abstract is preserved');
assert.deepEqual(scraped.item.attachments[0], scraped.mainPDF, 'EM primary PDF is preserved');
assert.equal(scraped.item.attachments.length, 2, 'full scrape adds SI after the primary PDF');
assert.equal(scraped.supplementaryQueries, 1, 'production scrape performs one bounded DOM SI lookup');

let scrapedOff = runScrape('recent', {attachSupplementary: false});
assert.equal(scrapedOff.item.completeCount, 1, 'EM item completes once with SI disabled');
assert.equal(scrapedOff.item.attachments.length, 1, 'SI-off keeps only the primary PDF');
assert.equal(scrapedOff.item.attachments[0].url, scrapedOff.mainPDF.url, 'SI-off preserves the primary PDF');
assert.equal(scrapedOff.supplementaryQueries, 0, 'SI-off performs no supplementary DOM lookup');

let scrapedFailure = runScrape('recent', {}, {throwSupplementary: true});
assert.equal(scrapedFailure.item.completeCount, 1, 'optional SI failure still completes the EM item once');
assert.equal(scrapedFailure.item.attachments.length, 1, 'optional SI failure leaves the primary PDF');
assert.equal(scrapedFailure.supplementaryQueries, 1, 'optional SI failure makes one bounded DOM lookup');
assert.ok(context.debugMessages.some(message => message.includes('Error attaching supplementary')),
	'optional SI failure is reported to translator debug');

console.log('MDPI Materials supplementary tests passed');
