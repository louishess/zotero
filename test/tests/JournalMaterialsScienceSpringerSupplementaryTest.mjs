import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(repoRoot, 'translators', 'Springer Link.js');
const fixturesPath = path.join(import.meta.dirname, 'data', 'journal-materials-science');

function attributesFrom(text) {
	let attrs = {};
	for (let match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		attrs[match[1]] = match[2] ?? match[3];
	}
	return attrs;
}

function stripTags(text) {
	return text.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ').trim();
}

class FixtureLink {
	constructor(attrs, body, baseURL) {
		this.attributes = attrs;
		this.href = new URL(attrs.href, baseURL).href;
		this.textContent = stripTags(body);
	}

	getAttribute(name) {
		return this.attributes[name] ?? null;
	}
}

class FixtureSection {
	constructor(attrs, body, baseURL) {
		this.attributes = attrs;
		this.links = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
			.map(match => new FixtureLink(attributesFrom(match[1]), match[2], baseURL));
	}

	getAttribute(name) {
		return this.attributes[name] ?? null;
	}

	querySelectorAll(selector) {
		if (selector === 'a[href]') return this.links.filter(link => link.getAttribute('href'));
		if (selector === 'a[data-test="supp-info-link"][href]') {
			return this.links.filter(link => link.getAttribute('data-test') === 'supp-info-link'
				&& link.getAttribute('href'));
		}
		return [];
	}
}

async function fixtureDocument(name, options = {}) {
	let html = await readFile(path.join(fixturesPath, name), 'utf8');
	let url = options.url || 'https://link.springer.com/article/10.1007/s10853-025-11859-6';
	let sections = [...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)]
		.map(match => new FixtureSection(attributesFrom(match[1]), match[2], url));
	return {
		location: {href: url},
		head: {getElementsByTagName: () => [{}]},
		querySelectorAll(selector) {
			if (options.throwSupplementary && selector === 'section[data-title]') {
				throw new Error('synthetic optional SI failure');
			}
			return selector === 'section[data-title]' ? sections : [];
		},
	};
}

let source = await readFile(translatorPath, 'utf8');
source = source.replace(/^\s*{[\s\S]*?}\s*?[\r\n]/, '');
source = source.slice(0, source.indexOf('/** BEGIN TEST CASES **/'));
let context = {
	URL,
	Set,
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
	ZU: {
		trimInternal: value => String(value).replace(/\s+/g, ' ').trim(),
		xpath: () => [],
		xpathText: () => '',
		strToISO: value => value,
		cleanAuthor: value => value,
		doGet: (url, callback) => {
			context.risRequests.push(url);
			callback('TY  - JOUR\nER  -');
		},
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	risRequests: [],
	text: () => '',
};
vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

function extract(doc, doi, prefs = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	return context.getSpringerSupplementaryAttachments(
		doc,
		doi,
		'https://link.springer.com/content/pdf/' + encodeURIComponent(doi) + '.pdf',
		context.prefs.supplementaryAsLink
	);
}

let recentDoc = await fixtureDocument('springer-jms-2025-positive.html');
let recent = extract(recentDoc, '10.1007/s10853-025-11859-6');
assert.equal(recent.length, 1);
assert.equal(recent[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.equal(recent[0].snapshot, true);
assert.match(recent[0].url, /10853_2025_11859_MOESM1_ESM\.docx$/);

let legacyDoc = await fixtureDocument('springer-jms-2020-positive.html', {
	url: 'https://link.springer.com/article/10.1007/s10853-020-04916-9'
});
let legacy = extract(legacyDoc, '10.1007/s10853-020-04916-9');
assert.equal(legacy.length, 2);
assert.ok(legacy.every(file => file.mimeType === 'image/tiff' && file.snapshot));

let noSIDoc = await fixtureDocument('springer-jms-2026-no-si.html');
assert.equal(extract(noSIDoc, '10.1007/s10853-026-13717-5').length, 0);

let linked = extract(recentDoc, '10.1007/s10853-025-11859-6', {supplementaryAsLink: true});
assert.equal(linked.length, 1);
assert.equal(linked[0].snapshot, false);
assert.equal(linked[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

let edgeDoc = await fixtureDocument('springer-jms-edge-cases.html');
let edges = extract(edgeDoc, '10.1007/s10853-025-11859-6');
assert.equal(edges.length, 6);
assert.equal(edges[0].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/same.zip?signature=one');
assert.equal(edges[1].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/same.zip?signature=two');
assert.equal(edges[2].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/unknown.blob?download=raw.pdf');
assert.equal(edges[2].mimeType, undefined);
assert.equal(edges[2].snapshot, false);
assert.equal(edges[3].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/unmarked.pdf');
assert.equal(edges[3].mimeType, 'application/pdf');
assert.equal(edges[3].snapshot, true);
assert.equal(edges[4].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/computational.com');
assert.equal(edges[4].mimeType, undefined, '.com remains an unknown linked file');
assert.equal(edges[4].snapshot, false);
assert.equal(edges[5].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/run.exe');
assert.equal(edges[5].mimeType, undefined, 'unknown executable-format files remain links');
assert.equal(edges[5].snapshot, false);

let scrapeRun;
context.Zotero = {
	loadTranslator(type) {
		assert.equal(type, 'import');
		return {
			setTranslator(id) {
				assert.equal(id, '32d59d2d-b65a-4da4-b0a3-bdd3cfb979e7');
			},
			setString() {},
			setHandler(name, handler) {
				assert.equal(name, 'itemDone');
				this.handler = handler;
			},
			translate() {
				let item = {
					itemType: 'journalArticle',
					title: 'Observed Journal of Materials Science title',
					DOI: scrapeRun.doi,
					creators: [],
					tags: [],
					attachments: [],
					completeCount: 0,
					complete() { this.completeCount++; },
				};
				this.handler(null, item);
				scrapeRun.item = item;
			},
		};
	},
};

async function runScrape(name, doi, prefs = {}, options = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.debugMessages.length = 0;
	context.risRequests.length = 0;
	let doc = await fixtureDocument(name, { ...options, url: `https://link.springer.com/article/${doi}` });
	scrapeRun = {doi};
	context.scrape(doc, doc.location.href);
	return scrapeRun;
}

let scraped = await runScrape('springer-jms-2025-positive.html', '10.1007/s10853-025-11859-6');
assert.equal(scraped.item.completeCount, 1, 'production scrape completes once');
assert.equal(scraped.item.title, 'Observed Journal of Materials Science title', 'metadata title is preserved');
assert.equal(scraped.item.DOI, '10.1007/s10853-025-11859-6', 'metadata DOI is preserved');
assert.equal(scraped.item.attachments.length, 2, 'production scrape adds SI after primary PDF');
assert.equal(scraped.item.attachments[0].mimeType, 'application/pdf', 'primary PDF remains first');
assert.equal(scraped.item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

let scrapedOff = await runScrape('springer-jms-2025-positive.html', '10.1007/s10853-025-11859-6', {attachSupplementary: false});
assert.equal(scrapedOff.item.completeCount, 1, 'SI-off production scrape completes once');
assert.equal(scrapedOff.item.attachments.length, 1, 'SI-off leaves only the primary PDF');
assert.equal(scrapedOff.risRequests?.length ?? context.risRequests.length, 1);
assert.ok(context.risRequests.every(url => !url.includes('media.springernature.com')), 'SI-off makes no SI request');

let scrapedFailure = await runScrape('springer-jms-2025-positive.html', '10.1007/s10853-025-11859-6', {}, {throwSupplementary: true});
assert.equal(scrapedFailure.item.completeCount, 1, 'optional SI failure completes once');
assert.equal(scrapedFailure.item.attachments.length, 1, 'optional SI failure preserves the primary PDF');
assert.ok(context.debugMessages.some(message => message.includes('Error attaching supplementary')));

console.log('Journal of Materials Science Springer supplementary tests passed');
