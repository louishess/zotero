import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const translatorPath = path.join(repoRoot, 'translators', 'RSC Publishing.js');
const fixturesPath = path.join(import.meta.dirname, 'data', 'rsc-chemical-science');

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixturesPath, `${name}.json`), 'utf8'));
}

class FixtureNode {
	constructor({ tagName = 'DIV', text = '', attrs = {}, className = '', children = [] } = {}) {
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
	let links = fixture.supplements.map((supplement) => {
		let link = new FixtureNode({
			tagName: 'A',
			text: supplement.text,
			className: 'openInAnotherWindow js-download-file-gtm-datalayer-event',
			attrs: { href: supplement.href },
		});
		let _container = new FixtureNode({
			className: 'dataSuppLink',
			text: supplement.parentText,
			children: [link],
		});
		return link;
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
				return { getAttribute: name => (name === 'content' ? fixture.name : null) };
			}
			return null;
		},
	};
	Object.defineProperty(document, 'supplementaryQueries', { get: () => queryCount });
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
		xpathText: (doc, selector) => (selector === '//meta[@name="citation_title"]/@content'
			? doc.querySelector('meta[name="citation_title"]')?.getAttribute('content')
			: ''),
	},
	Z: {
		getHiddenPref: name => context.prefs[name],
		debug: message => context.debugMessages.push(String(message)),
	},
	prefs: { attachSupplementary: true, supplementaryAsLink: false },
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
							abstractNote: 'Observed Chemical Science abstract',
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
vm.runInContext(source, context, { filename: translatorPath });

function detect(name, url = null) {
	let fixture = loadFixture(name);
	return context.detectWeb(makeDocument(fixture), url || fixture.canonicalURL);
}

function run(name, prefs = {}, documentOptions = {}) {
	Object.assign(context.prefs, { attachSupplementary: true, supplementaryAsLink: false }, prefs);
	context.debugMessages.length = 0;
	let fixture = loadFixture(name);
	let document = makeDocument(fixture, documentOptions);
	scrapeRun = { fixture };
	context.doWeb(document, fixture.canonicalURL);
	return { item: scrapeRun.item, queries: document.supplementaryQueries, debugMessages: [...context.debugMessages] };
}

assert.equal(detect('positive-pdf'), 'journalArticle', 'current Chemical Science canonical route is detected');
assert.equal(detect('positive-xlsx'), 'journalArticle', 'second current Chemical Science canonical route is detected');
assert.equal(detect('positive-pdf', loadFixture('positive-pdf').originalURL), 'journalArticle',
	'legacy article landing route remains detected');
assert.equal(detect('negative-no-si'), 'journalArticle', 'verified no-SI Chemical Science page remains in article scope');

let pdf = run('positive-pdf');
assert.equal(pdf.item.completeCount, 1, 'PDF control completes exactly once');
assert.equal(pdf.item.title, loadFixture('positive-pdf').name, 'PDF control metadata title is preserved');
assert.equal(pdf.item.DOI, '10.1039/D3SC05729A', 'PDF control DOI is preserved');
assert.equal(pdf.item.attachments.length, 2, 'PDF control keeps the primary PDF plus one SI child');
assert.equal(pdf.item.attachments[0].url, loadFixture('positive-pdf').primaryPDF, 'primary PDF URL is unchanged');
assert.equal(pdf.item.attachments[0].mimeType, 'application/pdf', 'primary PDF MIME is unchanged');
assert.equal(pdf.item.attachments[1].mimeType, 'application/pdf', 'observed PDF SI gets PDF MIME');
assert.equal(pdf.item.attachments[1].snapshot, true, 'file mode downloads known PDF SI');
assert.equal(pdf.queries, 1, 'PDF control performs one bounded DOM SI lookup');

let xlsx = run('positive-xlsx');
assert.equal(xlsx.item.completeCount, 1, 'XLSX control completes exactly once');
assert.equal(xlsx.item.attachments.length, 2, 'XLSX control keeps the primary PDF plus one SI child');
assert.equal(xlsx.item.attachments[1].url, loadFixture('positive-xlsx').supplements[0].href);
assert.equal(xlsx.item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'observed XLSX SI gets the XLSX MIME');

let linked = run('positive-xlsx', { supplementaryAsLink: true });
assert.equal(linked.item.completeCount, 1, 'link-mode item completes exactly once');
assert.equal(linked.item.attachments[1].snapshot, false, 'supplementaryAsLink produces a URL-only SI child');
assert.equal(linked.item.attachments[1].mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'link mode preserves observed XLSX MIME');

let off = run('positive-pdf', { attachSupplementary: false });
assert.equal(off.item.completeCount, 1, 'SI-off item completes exactly once');
assert.equal(off.item.attachments.length, 1, 'SI-off preserves only the primary PDF');
assert.equal(off.queries, 0, 'SI-off performs no supplementary DOM lookup');

let noSI = run('negative-no-si');
assert.equal(noSI.item.completeCount, 1, 'verified no-SI item completes exactly once');
assert.equal(noSI.item.attachments.length, 1, 'verified no-SI page adds no attachment');
assert.equal(noSI.queries, 1, 'no-SI production check performs one bounded DOM lookup');

let edges = run('edge-cases');
assert.equal(edges.item.completeCount, 1, 'edge-case item completes exactly once');
assert.equal(edges.item.attachments.length, 4, 'edge fixture keeps distinct query-bearing files and one unknown file');
assert.equal(edges.item.attachments[1].url.includes('token=one'), true, 'signed/query-bearing URL is preserved');
assert.equal(edges.item.attachments[1].url.includes('#'), false, 'fragment is removed from the saved URL');
assert.equal(edges.item.attachments[2].url.includes('token=two'), true, 'distinct query-bearing URL is retained');
assert.notEqual(edges.item.attachments[1].url, edges.item.attachments[2].url, 'distinct query parameters do not merge files');
assert.equal(edges.item.attachments[3].mimeType, undefined, 'unknown CIF type remains untyped');
assert.equal(edges.item.attachments[3].snapshot, false, 'unknown CIF type remains a link');
assert.ok(edges.item.attachments.every(attachment => !attachment.url.includes('/article-supplement/827846/')),
	'cross-article supplementary route is rejected');
assert.ok(edges.item.attachments.every(attachment => !attachment.url.includes('cdn.example.test')),
	'off-host supplementary route is rejected');

let failed = run('positive-pdf', {}, { throwSupplementary: true });
assert.equal(failed.item.completeCount, 1, 'optional SI failure still completes metadata once');
assert.equal(failed.item.attachments.length, 1, 'optional SI failure preserves the primary PDF');
assert.equal(failed.queries, 1, 'optional SI failure makes one bounded DOM lookup');
assert.ok(failed.debugMessages.some(message => message.includes('Error attaching supplementary')),
	'optional SI failure is reported to translator debug');

console.log('RSC Chemical Science supplementary tests passed');
