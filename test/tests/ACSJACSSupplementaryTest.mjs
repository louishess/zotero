import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(repoRoot, 'translators', 'ACS Publications.js');
const fixturesPath = path.join(import.meta.dirname, 'data', 'acs-jacs-supplementary');

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

function makeDocument(fixture) {
	let links = fixture.supplements.map(supplement => ({
		href: supplement.url,
		getAttribute(name) {
			if (name === 'data-doctype') return supplement.dataDoctype;
			if (name === 'aria-label') return supplement.ariaLabel;
			return null;
		},
	}));
	let metaDOI = {
		getAttribute(name) {
			return name === 'content' ? fixture.doi : null;
		},
	};
	return {
		location: {href: fixture.url},
		querySelector(selector) {
			return selector === 'meta[name="citation_doi"]' ? metaDOI : null;
		},
		querySelectorAll(selector) {
			// These are the two selectors observed on the current ACS Silverchair pages.
			if (selector.includes('a[data-doctype="dataSupplementDoc"][href]')
				|| selector.includes('.article_content-left .suppl-anchor[href]')) {
				return links;
			}
			return [];
		},
	};
}

let source = fs.readFileSync(translatorPath, 'utf8');
source = source.replace(/^\s*{[\s\S]*?}\s*?[\r\n]/, '');
source = source.slice(0, source.indexOf('/** BEGIN TEST CASES **/'));

let context = {
	URL,
	Set,
	Promise,
	setTimeout,
	attr: (doc, selector, name) => {
		let node = doc.querySelector(selector);
		return node && node.getAttribute(name);
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
		selectItems: async () => context.selectionResult,
	},
	ZU: {
		trimInternal: value => String(value).trim().replace(/\s+/g, ' '),
	},
	text: (node, selector) => selector === '.access-title' ? node.accessTitle : node.textContent,
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
	requestCalls: [],
	requestQueue: [],
	requestDocumentCalls: [],
	selectionResult: null,
};

let lastItem;
context.Zotero = {
	loadTranslator() {
		return {
			handler: null,
			setTranslator() {},
			setDocument() {},
			setHandler(_name, handler) {
				this.handler = handler;
			},
			async translate() {
				let fixture = context.activeFixture;
				let item = {
					itemType: 'journalArticle',
					title: fixture.title,
					DOI: fixture.doi,
					creators: [{lastName: 'Observed', firstName: 'Author', creatorType: 'author'}],
					attachments: [{
						title: 'Full Text PDF',
						url: 'https://pubs.acs.org/doi/pdf/' + fixture.doi,
						mimeType: 'application/pdf',
					}],
					completeCount: 0,
					complete() {
						this.completeCount++;
						lastItem = this;
					},
				};
				this.handler(null, item);
			},
		};
	},
};
context.requestJSON = async (url, options) => {
	context.requestCalls.push({url, options});
	let response = context.requestQueue.shift();
	if (response instanceof Error) throw response;
	return response;
};
context.requestDocument = async url => {
	context.requestDocumentCalls.push(url);
	return makeDocument(context.activeFixture);
};

vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

async function run(name, prefs = {}, responses = []) {
	context.activeFixture = loadFixture(name);
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.requestCalls = [];
	context.requestQueue = [...responses];
	context.requestDocumentCalls = [];
	context.debugMessages = [];
	lastItem = null;
	let doc = makeDocument(context.activeFixture);
	await context.doWeb(doc, context.activeFixture.url);
	return {item: lastItem, requests: [...context.requestCalls], debugMessages: [...context.debugMessages]};
}

function makeSearchDocument(fixture) {
	let row = {
		href: fixture.url,
		textContent: fixture.title,
		accessTitle: fixture.title,
	};
	return {
		location: {href: 'https://pubs.acs.org/jacsat/latest-articles'},
		querySelectorAll(selector) {
			return selector.includes('.issue-item_title a') ? [row] : [];
		},
	};
}

async function runSearch(name, selection, responses = []) {
	context.activeFixture = loadFixture(name);
	context.prefs = {attachSupplementary: true, supplementaryAsLink: false};
	context.selectionResult = selection;
	context.requestCalls = [];
	context.requestQueue = [...responses];
	context.requestDocumentCalls = [];
	context.debugMessages = [];
	lastItem = null;
	await context.doWeb(makeSearchDocument(context.activeFixture), 'https://pubs.acs.org/jacsat/latest-articles');
	return {
		item: lastItem,
		requests: [...context.requestCalls],
		requestDocumentCalls: [...context.requestDocumentCalls],
	};
}

let recent = await run('positive-2026', {}, [[]]);
assert.equal(recent.item.completeCount, 1, 'current JACS item completes exactly once');
assert.equal(recent.item.title, loadFixture('positive-2026').title, 'metadata title is unchanged');
assert.equal(recent.item.DOI, '10.1021/jacs.5c22031', 'metadata DOI is unchanged');
assert.equal(recent.item.attachments.length, 2, 'current JACS item has primary PDF plus SI');
assert.equal(recent.item.attachments[0].url, 'https://pubs.acs.org/doi/pdf/10.1021/jacs.5c22031', 'primary PDF route is unchanged');
assert.equal(recent.item.attachments[0].mimeType, 'application/pdf', 'primary PDF MIME is unchanged');
assert.equal(recent.item.attachments[1].url, loadFixture('positive-2026').supplements[0].url, 'current JACS SI URL is preserved');
assert.equal(recent.item.attachments[1].mimeType, 'application/pdf', 'observed PDF SI gets PDF MIME');
assert.equal(recent.item.attachments[1].snapshot, true, 'file mode downloads known PDF SI');
assert.equal(recent.requests.length, 1, 'one bounded Figshare search precedes page fallback');

let legacy = await run('positive-2025', {}, [[]]);
assert.equal(legacy.item.completeCount, 1, 'second JACS item completes exactly once');
assert.equal(legacy.item.attachments.length, 2, 'second JACS control has primary PDF plus SI');
assert.equal(legacy.item.attachments[1].url, loadFixture('positive-2025').supplements[0].url);
assert.equal(legacy.item.attachments[1].mimeType, 'application/pdf');

let linked = await run('positive-2026', {supplementaryAsLink: true});
assert.equal(linked.requests.length, 0, 'link mode uses the observed page link without Figshare discovery');
assert.equal(linked.item.completeCount, 1, 'link-mode item completes exactly once');
assert.equal(linked.item.attachments[1].snapshot, false, 'link mode leaves SI URL-only');
assert.equal(linked.item.attachments[1].mimeType, 'application/pdf', 'link mode preserves known MIME');

let off = await run('positive-2026', {attachSupplementary: false}, [new Error('SI discovery must not run')]);
assert.equal(off.requests.length, 0, 'SI-off production gate makes no discovery request');
assert.equal(off.item.completeCount, 1, 'SI-off item completes exactly once');
assert.equal(off.item.attachments.length, 1, 'SI-off preserves only the primary PDF');

let noSI = await run('negative-2026', {}, [[]]);
assert.equal(noSI.item.completeCount, 1, 'verified no-SI item completes exactly once');
assert.equal(noSI.item.attachments.length, 1, 'verified no-SI control keeps only the primary PDF');
assert.equal(noSI.requests.length, 1, 'no-SI control uses only the bounded optional Figshare search');

let figshare = await run('positive-2026', {}, [
	[
		{
			resource_doi: '10.1021/JACS.5C22031',
			doi: '10.6084/m9.figshare.32957544.s1',
			url: 'https://api.figshare.com/v2/articles/32957544',
		},
		{
			resource_doi: '10.1021/JACS.5C22031',
			doi: '10.6084/m9.figshare.32957545.s2',
			url: 'https://api.figshare.com/v2/articles/32957545',
		},
		{
			resource_doi: '10.1021/other.1',
			doi: '10.6084/m9.figshare.00000000.s1',
			url: 'https://api.figshare.com/v2/articles/00000000',
		},
	],
	{
		resource_doi: '10.1021/JACS.5C22031',
		files: [
			{
				name: 'same.pdf',
				download_url: 'https://ndownloader.figshare.com/files/one?signature=keep-one',
				mimetype: 'application/pdf',
			},
			{
				name: 'same.pdf',
				download_url: 'https://ndownloader.figshare.com/files/two?signature=keep-two',
				mimetype: 'application/pdf',
			},
			{
				name: 'molecule.fcf',
				download_url: 'https://ndownloader.figshare.com/files/fcf?token=keep-fcf',
			},
			{
				name: 'research.com',
				download_url: 'https://ndownloader.figshare.com/files/code?token=keep-code',
			},
		],
	},
	{
		resource_doi: '10.1021/JACS.5C22031',
		files: [],
	},
]);
assert.equal(figshare.requests.length, 3, 'Figshare discovery permits at most search plus two observed records');
assert.equal(figshare.item.completeCount, 1, 'Figshare item completes exactly once');
assert.equal(figshare.item.attachments.length, 5, 'Figshare files replace the page fallback only when the manifest is valid');
assert.equal(figshare.item.attachments[1].url.includes('signature=keep-one'), true, 'signed Figshare parameters are preserved');
assert.equal(figshare.item.attachments[2].url.includes('signature=keep-two'), true, 'same-named distinct Figshare files remain distinct');
assert.notEqual(figshare.item.attachments[1].url, figshare.item.attachments[2].url, 'same names do not deduplicate distinct URLs');
assert.equal(figshare.item.attachments[3].mimeType, undefined, 'FCF remains an unknown file type');
assert.equal(figshare.item.attachments[3].snapshot, false, 'unknown FCF remains a link');
assert.equal(figshare.item.attachments[4].mimeType, undefined, 'research code is not assigned a guessed MIME type');
assert.equal(figshare.item.attachments[4].snapshot, false, 'research code remains a link');

let duplicateRecords = await run('positive-2026', {}, [
	[
		{
			resource_doi: '10.1021/JACS.5C22031',
			doi: '10.6084/m9.figshare.32957544.s1',
			url: 'https://api.figshare.com/v2/articles/32957544',
		},
		{
			resource_doi: '10.1021/JACS.5C22031',
			doi: '10.6084/m9.figshare.32957544.s1',
			url: 'https://api.figshare.com/v2/articles/32957544',
		},
	],
	{
		resource_doi: '10.1021/JACS.5C22031',
		files: [{name: 'one.pdf', download_url: 'https://ndownloader.figshare.com/files/one', mimetype: 'application/pdf'}],
	},
]);
assert.equal(duplicateRecords.requests.length, 2, 'duplicate Figshare detail records make one detail request');
assert.equal(duplicateRecords.item.attachments.length, 2, 'duplicate Figshare records preserve one SI file');

let mismatchedDetail = await run('positive-2026', {}, [
	[
		{
			resource_doi: '10.1021/JACS.5C22031',
			doi: '10.6084/m9.figshare.32957544.s1',
			url: 'https://api.figshare.com/v2/articles/32957544',
		},
	],
	{
		resource_doi: '10.1021/wrong-doi',
		files: [{name: 'wrong.pdf', download_url: 'https://ndownloader.figshare.com/files/wrong', mimetype: 'application/pdf'}],
	},
]);
assert.equal(mismatchedDetail.item.completeCount, 1, 'mismatched Figshare detail still completes metadata once');
assert.equal(mismatchedDetail.item.attachments.length, 2, 'mismatched Figshare detail falls back to the observed page SI');
assert.equal(mismatchedDetail.item.attachments[1].url, loadFixture('positive-2026').supplements[0].url);

let oversized = await run('positive-2026', {}, [[
	{resource_doi: '10.1021/jacs.5c22031', doi: '10.6084/m9.figshare.1.s1', url: 'https://api.figshare.com/v2/articles/1'},
	{resource_doi: '10.1021/jacs.5c22031', doi: '10.6084/m9.figshare.2.s2', url: 'https://api.figshare.com/v2/articles/2'},
	{resource_doi: '10.1021/jacs.5c22031', doi: '10.6084/m9.figshare.3.s3', url: 'https://api.figshare.com/v2/articles/3'},
]]);
assert.equal(oversized.requests.length, 1, 'oversized Figshare manifest makes no detail requests');
assert.equal(oversized.item.attachments.length, 2, 'oversized Figshare manifest falls back to page SI');
assert.ok(oversized.debugMessages.some(message => message.includes('record limit reached')));

let invalidDetailURL = await run('positive-2026', {}, [[
	{
		resource_doi: '10.1021/JACS.5C22031',
		doi: '10.6084/m9.figshare.32957544.s1',
		url: 'https://user:pass@api.figshare.com:443/v2/articles/32957544?token=secret',
	},
]]);
assert.equal(invalidDetailURL.requests.length, 1, 'invalid Figshare detail URL is rejected before request');
assert.equal(invalidDetailURL.item.attachments.length, 2, 'invalid Figshare detail URL falls back to page SI');

let failed = await run('positive-2026', {}, [new Error('synthetic Figshare access failure')]);
assert.equal(failed.item.completeCount, 1, 'Figshare failure completes metadata once');
assert.equal(failed.item.attachments.length, 2, 'Figshare failure preserves page SI and primary PDF');
assert.ok(failed.debugMessages.some(message => message.includes('Figshare supplementary lookup failed')));

let malformed = await run('positive-2026', {}, [{not: 'an array'}]);
assert.equal(malformed.item.completeCount, 1, 'malformed Figshare response completes metadata once');
assert.equal(malformed.item.attachments.length, 2, 'malformed Figshare response preserves page SI and primary PDF');

let selected = await runSearch('positive-2026', {
	'https://pubs.acs.org/jacsat/article/148/28/29684/5206327/Structural-Engineering-of-Cyanine-Dyes-to-Access': 'JACS selected article',
}, [[]]);
assert.equal(selected.item.completeCount, 1, 'multiple selection completes the selected item once');
assert.equal(selected.item.attachments.length, 2, 'multiple selection uses the production SI path');
assert.equal(selected.requestDocumentCalls.length, 1, 'multiple selection fetches the selected article once');

let cancelled = await runSearch('positive-2026', null, [new Error('cancelled selection must not fetch')]);
assert.equal(cancelled.item, null, 'selection cancellation produces no item');
assert.equal(cancelled.requestDocumentCalls.length, 0, 'selection cancellation makes no article request');
assert.equal(cancelled.requests.length, 0, 'selection cancellation makes no Figshare request');

console.log('ACS JACS supplementary tests passed');
