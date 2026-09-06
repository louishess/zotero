import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..');
const translatorPath = path.join(repoRoot, '..', 'translators', 'Springer Link.js');
const fixturesPath = path.join(import.meta.dirname, 'data', 'analytical-bioanalytical-chemistry');

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
		return [];
	}
}

async function fixtureDocument(name, options = {}) {
	let html = await readFile(path.join(fixturesPath, name), 'utf8');
	return fixtureDocumentFromHTML(html, options);
}

function fixtureDocumentFromHTML(html, options = {}) {
	let url = options.url || 'https://link.springer.com/article/10.1007/s00216-026-06632-w';
	let sections = [...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)]
		.map(match => new FixtureSection(attributesFrom(match[1]), match[2], url));
	return {
		location: {href: url},
		head: {getElementsByTagName: () => [{}]},
		querySelectorAll(selector) {
			if (options.throwSupplementary && selector === 'section[data-title]') {
				throw new Error('synthetic optional SI failure');
			}
			if (selector === 'section[data-title]') return sections;
			return [];
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

let recentDoc = await fixtureDocument('springer-abc-2026-positive.html');
let recent = extract(recentDoc, '10.1007/s00216-026-06632-w');
assert.equal(recent.length, 1);
assert.equal(recent[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.equal(recent[0].snapshot, true);
assert.match(recent[0].url, /216_2026_6632_MOESM1_ESM\.docx$/);

let olderDoc = await fixtureDocument('springer-abc-2020-positive.html', {
	url: 'https://link.springer.com/article/10.1007/s00216-020-02957-2',
});
let older = extract(olderDoc, '10.1007/s00216-020-02957-2');
assert.equal(older.length, 1);
assert.equal(older[0].mimeType, 'application/pdf');
assert.equal(older[0].snapshot, true);
assert.match(older[0].url, /216_2020_2957_MOESM1_ESM\.pdf$/);

let noSIDoc = await fixtureDocument('springer-abc-2026-no-si.html', {
	url: 'https://link.springer.com/article/10.1007/s00216-026-06704-x',
});
assert.equal(extract(noSIDoc, '10.1007/s00216-026-06704-x').length, 0);

let edgeDoc = fixtureDocumentFromHTML(`
	<section data-title="Supplementary Information">
		<a data-test="supp-info-link" href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/results.csv">Results (CSV)</a>
		<a data-test="supp-info-link" href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/results.csv">Results duplicate (CSV)</a>
		<a data-test="supp-info-link" href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/raw.blob?download=raw.pdf">Unknown data</a>
		<a data-test="supp-info-link" href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/viewer/page.pdf">Viewer route</a>
		<a data-test="supp-info-link" href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-020-02957-2/MediaObjects/other.pdf">Other article</a>
		<a data-test="supp-info-link" href="https://example.invalid/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/not.pdf">Other host</a>
	</section>
`, {url: 'https://link.springer.com/article/10.1007/s00216-026-06632-w'});
let edges = extract(edgeDoc, '10.1007/s00216-026-06632-w');
assert.equal(edges.length, 2, 'same-DOI direct files are scoped and exact duplicates are removed');
assert.equal(edges[0].mimeType, 'text/csv', 'known files receive their observed MIME type');
assert.equal(edges[0].snapshot, true);
assert.equal(edges[1].url, 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/raw.blob?download=raw.pdf');
assert.equal(edges[1].mimeType, undefined, 'unknown extensions remain linked without a guessed MIME type');
assert.equal(edges[1].snapshot, false);

let linked = extract(recentDoc, '10.1007/s00216-026-06632-w', {supplementaryAsLink: true});
assert.equal(linked.length, 1);
assert.equal(linked[0].snapshot, false);
assert.equal(linked[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

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
					title: 'Observed Analytical and Bioanalytical Chemistry title',
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
	let doc = await fixtureDocument(name, {...options, url: `https://link.springer.com/article/${doi}`});
	scrapeRun = {doi};
	context.scrape(doc, doc.location.href);
	return scrapeRun;
}

let scraped = await runScrape('springer-abc-2026-positive.html', '10.1007/s00216-026-06632-w');
assert.equal(scraped.item.completeCount, 1, 'production scrape completes once');
assert.equal(scraped.item.title, 'Observed Analytical and Bioanalytical Chemistry title', 'metadata title is preserved');
assert.equal(scraped.item.DOI, '10.1007/s00216-026-06632-w', 'metadata DOI is preserved');
assert.equal(scraped.item.attachments.length, 2, 'production scrape adds SI after primary PDF');
assert.equal(scraped.item.attachments[0].mimeType, 'application/pdf', 'primary PDF remains first');
assert.equal(scraped.item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.equal(scraped.risRequests?.length ?? context.risRequests.length, 1, 'metadata uses one RIS request');
assert.ok(context.risRequests.every(url => !url.includes('media.springernature.com')), 'SI discovery adds no request');

let scrapedOff = await runScrape('springer-abc-2026-positive.html', '10.1007/s00216-026-06632-w', {attachSupplementary: false});
assert.equal(scrapedOff.item.completeCount, 1, 'SI-off production scrape completes once');
assert.equal(scrapedOff.item.attachments.length, 1, 'SI-off leaves only the primary PDF');
assert.equal(scrapedOff.risRequests?.length ?? context.risRequests.length, 1);
assert.ok(context.risRequests.every(url => !url.includes('media.springernature.com')), 'SI-off makes no SI request');

let scrapedNoSI = await runScrape('springer-abc-2026-no-si.html', '10.1007/s00216-026-06704-x');
assert.equal(scrapedNoSI.item.completeCount, 1, 'no-SI production scrape completes once');
assert.equal(scrapedNoSI.item.attachments.length, 1, 'no-SI production scrape preserves the primary PDF');

let scrapedFailure = await runScrape('springer-abc-2026-positive.html', '10.1007/s00216-026-06632-w', {}, {throwSupplementary: true});
assert.equal(scrapedFailure.item.completeCount, 1, 'optional SI failure completes once');
assert.equal(scrapedFailure.item.attachments.length, 1, 'optional SI failure preserves the primary PDF');
assert.ok(context.debugMessages.some(message => message.includes('Error attaching supplementary')));

console.log('Analytical and Bioanalytical Chemistry Springer supplementary tests passed');
