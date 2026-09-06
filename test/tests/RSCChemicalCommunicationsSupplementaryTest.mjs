import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(repoRoot, 'translators', 'RSC Publishing.js');
const fixturesPath = path.join(import.meta.dirname, 'data', 'rsc-chemical-communications');

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

class FixtureNode {
	constructor({tagName = 'DIV', text = '', attrs = {}, className = '', children = []} = {}) {
		this.nodeName = tagName;
		this.textContent = text;
		this.attrs = attrs;
		this.className = className;
		this.children = children;
		this.parentNode = null;
		for (let child of children) child.parentNode = this;
		if (tagName === 'A') this.href = attrs.href;
	}

	getAttribute(name) {
		return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
	}

	closest(selector) {
		if (selector !== '.dataSuppLink') return null;
		if (this.className === 'dataSuppLink') return this;
		return this.parentNode?.closest(selector) ?? null;
	}
}

function makeDocument(fixture, options = {}) {
	let links = fixture.supplements.map(supplement => {
		let link = new FixtureNode({
			tagName: 'A',
			text: supplement.text,
			attrs: {href: supplement.href},
			className: 'openInAnotherWindow js-download-file-gtm-datalayer-event',
		});
		return new FixtureNode({
			className: 'dataSuppLink',
			text: supplement.parentText,
			children: [link],
		}).children[0];
	});
	let queryCount = 0;
	let document = {
		location: new URL(fixture.canonicalURL),
		querySelectorAll(selector) {
			queryCount++;
			assert.match(selector, /a\.js-download-file-gtm-datalayer-event\[href\*="\/article-supplement\/"\]/,
				'production selector includes the observed RSC supplementary-link route');
			if (options.throwSupplementary) throw new Error('synthetic optional SI failure');
			return links;
		},
		querySelector(selector) {
			if (selector === 'meta[name="citation_title"]') {
				return {getAttribute: name => name === 'content' ? fixture.name : null};
			}
			return null;
		},
	};
	Object.defineProperty(document, 'supplementaryQueries', {get: () => queryCount});
	return document;
}

let source = fs.readFileSync(translatorPath, 'utf8');
source = source.slice(source.indexOf('*/', source.indexOf('/*')) + 2);
source = source.slice(0, source.indexOf('/** BEGIN TEST CASES **/'));

let context = {
	URL,
	ZU: {
		trimInternal: value => String(value).trim().replace(/\s+/g, ' '),
		xpath: () => [],
		xpathText: (doc, selector) => selector === '//meta[@name="citation_title"]/@content'
			? doc.querySelector('meta[name="citation_title"]')?.getAttribute('content')
			: '',
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	prefs: {attachSupplementary: true, supplementaryAsLink: false},
	debugMessages: [],
};

let scrapeRun;
context.Zotero = {
	loadTranslator() {
		let translator = {
			handler: null,
			setTranslator(id) {
				assert.equal(id, '951c027d-74ac-47d4-a107-9c3069ab7b48');
			},
			setDocument() {},
			setHandler(name, handler) {
				assert.equal(name, 'itemDone');
				this.handler = handler;
			},
			getTranslatorObject(callback) {
			callback({
				itemType: 'journalArticle',
				doWeb: () => {
					let fixture = scrapeRun.fixture;
					let item = {
						itemType: 'journalArticle',
						title: fixture.name,
						DOI: fixture.doi,
						abstractNote: 'Observed Chemical Communications abstract',
						tags: [],
						attachments: [{
							title: 'Full Text PDF',
							url: fixture.primaryPDF,
							mimeType: 'application/pdf',
							snapshot: true,
						}],
						completeCount: 0,
						complete() {
							this.completeCount++;
						},
					};
					translator.handler(null, item);
					scrapeRun.item = item;
				},
			});
			},
		};
		return translator;
	},
};

vm.createContext(context);
vm.runInContext(source, context, {filename: translatorPath});

function detect(name, url = null) {
	let fixture = loadFixture(name);
	return context.detectWeb(makeDocument(fixture), url || fixture.canonicalURL);
}

function run(name, prefs = {}, documentOptions = {}) {
	Object.assign(context.prefs, {attachSupplementary: true, supplementaryAsLink: false}, prefs);
	context.debugMessages.length = 0;
	let fixture = loadFixture(name);
	let document = makeDocument(fixture, documentOptions);
	scrapeRun = {fixture};
	context.doWeb(document, fixture.canonicalURL);
	return {item: scrapeRun.item, queries: document.supplementaryQueries, debugMessages: [...context.debugMessages]};
}

let recentFixture = loadFixture('positive-recent');
assert.equal(detect('positive-recent'), 'journalArticle', 'current ChemComm canonical route is detected');
assert.equal(detect('positive-recent', recentFixture.originalURL), 'journalArticle',
	'current article landing route remains detected');
assert.equal(detect('positive-older'), 'journalArticle', 'legacy ChemComm canonical route is detected');
assert.equal(detect('positive-older', loadFixture('positive-older').originalURL), 'journalArticle',
	'legacy article landing route remains detected');
assert.equal(detect('negative-no-si'), 'journalArticle', 'verified no-SI ChemComm page remains in article scope');

let recent = run('positive-recent');
assert.equal(recent.item.completeCount, 1, 'recent item completes exactly once');
assert.equal(recent.item.title, recentFixture.name, 'recent metadata title is preserved');
assert.equal(recent.item.DOI, recentFixture.doi, 'recent DOI is preserved');
assert.equal(recent.item.attachments.length, 3, 'recent item keeps primary PDF plus PDF and CIF SI');
assert.equal(recent.item.attachments[0].url, recentFixture.primaryPDF, 'recent primary PDF URL is unchanged');
assert.equal(recent.item.attachments[0].mimeType, 'application/pdf', 'recent primary PDF MIME is unchanged');
assert.equal(recent.item.attachments[1].url, recentFixture.supplements[0].href, 'recent PDF SI URL is preserved');
assert.equal(recent.item.attachments[1].mimeType, 'application/pdf', 'recent PDF SI gets PDF MIME');
assert.equal(recent.item.attachments[1].snapshot, true, 'recent known PDF SI downloads in file mode');
assert.equal(recent.item.attachments[2].url, recentFixture.supplements[1].href, 'recent CIF SI URL is preserved');
assert.equal(recent.item.attachments[2].mimeType, undefined, 'unknown CIF SI remains untyped');
assert.equal(recent.item.attachments[2].snapshot, false, 'unknown CIF SI remains a link');
assert.equal(recent.queries, 1, 'recent control performs one bounded DOM SI lookup');

let olderFixture = loadFixture('positive-older');
let older = run('positive-older');
assert.equal(older.item.completeCount, 1, 'older item completes exactly once');
assert.equal(older.item.attachments.length, 3, 'older item keeps primary PDF plus PDF and TXT SI');
assert.equal(older.item.attachments[0].url, olderFixture.primaryPDF, 'older primary PDF URL is unchanged');
assert.equal(older.item.attachments[1].mimeType, 'application/pdf', 'older PDF SI gets PDF MIME');
assert.equal(older.item.attachments[2].url, olderFixture.supplements[1].href, 'older TXT SI URL is preserved');
assert.equal(older.item.attachments[2].mimeType, 'text/plain', 'older TXT SI gets observed TXT MIME');

let linked = run('positive-recent', {supplementaryAsLink: true});
assert.equal(linked.item.completeCount, 1, 'link-mode item completes exactly once');
assert.equal(linked.item.attachments[1].snapshot, false, 'link mode leaves known SI URL-only');
assert.equal(linked.item.attachments[1].mimeType, 'application/pdf', 'link mode preserves PDF MIME');
assert.equal(linked.item.attachments[2].snapshot, false, 'link mode leaves unknown SI URL-only');

let off = run('positive-recent', {attachSupplementary: false});
assert.equal(off.item.completeCount, 1, 'SI-off item completes exactly once');
assert.equal(off.item.attachments.length, 1, 'SI-off preserves only the primary PDF');
assert.equal(off.queries, 0, 'SI-off performs no supplementary DOM lookup');

let noSI = run('negative-no-si');
assert.equal(noSI.item.completeCount, 1, 'verified no-SI item completes exactly once');
assert.equal(noSI.item.attachments.length, 1, 'verified no-SI page adds no attachment');
assert.equal(noSI.queries, 1, 'no-SI production check performs one bounded DOM lookup');

let failed = run('positive-recent', {}, {throwSupplementary: true});
assert.equal(failed.item.completeCount, 1, 'optional SI failure still completes metadata once');
assert.equal(failed.item.attachments.length, 1, 'optional SI failure preserves the primary PDF');
assert.equal(failed.queries, 1, 'optional SI failure makes one bounded DOM lookup');
assert.ok(failed.debugMessages.some(message => message.includes('Error attaching supplementary')),
	'optional SI failure is reported to translator debug');

console.log('RSC Chemical Communications supplementary tests passed');
