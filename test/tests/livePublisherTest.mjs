/*
	Live diagnostic coverage for publisher translators.

	Run explicitly with:
	LIVE_PUBLISHER_TESTS=true HEADLESS=true npx mocha test/tests/livePublisherTest.mjs

	These tests load the real Connector in Chrome for Testing and stub only the
	final save-to-Zotero call. They intentionally use live publisher pages and
	are therefore excluded from the normal test run.
*/

import {
	Tab,
	background,
	delay,
	offscreen,
	stubConnectorCallMethod,
	stubHTTPRequest
} from '../support/utils.mjs';
import { seedTranslatorPrefs } from '../support/puppeteerSetup.mjs';

const PUBLISHER_TRANSLATOR_IDS = [
	'938ebe32-2b2e-4349-a5b3-b3a05d3de627', // ACS Publications
	'3bae3a55-f021-4b59-8a14-43701f336adf', // Silverchair
	'6614a99-479a-4524-8e30-686e4d66663e', // Nature Publishing Group
	'f26cfb71-efd7-47ae-a28c-d4d8852096bd', // Cell Press
	'ca0e7488-ef20-4485-8499-9c47e60dcfa7', // RSC Publishing
	'5af42734-7cd5-4c69-97fc-bc406999bdba', // Atypon Journals (Science.org)
	'fe728bc9-595a-4f03-98fc-766f1d8d0936', // Wiley Online Library
	'acf93a17-a83b-482b-a45e-0c64cfd49bee', // MDPI Journals
	'd6c6210a-297c-4b2c-8c43-48cb503cc49e', // Springer Link
	'cb9e794e-7a65-47cd-90f6-58cdd191e8b0' // Frontiers
];

const CASES = [
	{
		publisher: 'Molecules rollout', label: 'MDPI Journals',
		url: 'https://www.mdpi.com/1420-3049/31/17/3117',
		expectedDOI: '10.3390/molecules31173117', expectedSupplementCount: 1,
		primaryPattern: /\/1420-3049\/31\/17\/3117\/pdf(?:[?#]|$)/,
		supplementPattern: /\/1420-3049\/31\/17\/3117\/s\d+(?:[?#]|$)/,
	},
	{
		publisher: 'Catalysts rollout', label: 'MDPI Journals',
		url: 'https://www.mdpi.com/2073-4344/16/9/804',
		expectedDOI: '10.3390/catal16090804', expectedSupplementCount: 1,
		primaryPattern: /\/2073-4344\/16\/9\/804\/pdf(?:[?#]|$)/,
		supplementPattern: /\/2073-4344\/16\/9\/804\/s\d+(?:[?#]|$)/,
	},
	{
		publisher: 'Materials Science rollout', label: 'Springer Link',
		url: 'https://link.springer.com/article/10.1007/s10853-025-11859-6',
		expectedDOI: '10.1007/s10853-025-11859-6', expectedSupplementCount: 1,
		primaryPattern: /\/content\/pdf\//,
		supplementPattern: /media\.springernature\.com\/original\/.*\/MediaObjects\//i,
	},
	{
		publisher: 'Frontiers Chemistry rollout', label: 'Frontiers',
		url: 'https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2021.685783/full',
		expectedDOI: '10.3389/fchem.2021.685783', expectedSupplementCount: 1,
		primaryPattern: /\/articles\/10\.3389\/fchem\.2021\.685783\/pdf(?:[?#]|$)/,
		supplementPattern: /\/articles\/685783\/file\//,
	},
	{
		publisher: 'ACS',
		label: ['ACS Publications', 'Silverchair'],
		url: process.env.LIVE_ACS_URL
			|| 'https://pubs.acs.org/jacsat/article/148/28/29684/5206327/Structural-Engineering-of-Cyanine-Dyes-to-Access',
		expectedDOI: process.env.LIVE_ACS_DOI || '10.1021/jacs.5c22031',
		expectedSupplementCount: Number(process.env.LIVE_ACS_SUPPLEMENT_COUNT || 1)
	},
	{
		publisher: 'ACS DOI redirect',
		label: ['ACS Publications', 'Silverchair'],
		url: 'https://pubs.acs.org/doi/10.1021/jacs.5c22031'
	},
	{
		publisher: 'Nature',
		label: 'Nature Publishing Group',
		url: 'https://www.nature.com/articles/s41586-026-10843-7'
	},
	{
		publisher: 'Cell Press',
		label: 'Cell Press',
		url: process.env.LIVE_CELL_PRESS_URL
			|| 'https://www.cell.com/heliyon/fulltext/S2405-8440(24)04671-1',
		expectedDOI: process.env.LIVE_CELL_PRESS_DOI || '10.1016/j.heliyon.2024.e28640',
		expectedSupplementCount: Number(process.env.LIVE_CELL_PRESS_SUPPLEMENT_COUNT || 1)
	},
	{
		publisher: 'RSC',
		label: 'RSC Publishing',
		url: 'https://pubs.rsc.org/ma/article/doi/10.1039/D6MA00514D/1287895/Casuarina-Derived-Carbon-Dots-for-Multifunctional?searchresult=1',
		expectedDOI: '10.1039/D6MA00514D',
		expectedSupplementCount: 3
	},
	{
		publisher: 'Science requested (no published SI)',
		label: 'Atypon Journals',
		url: 'https://www.science.org/doi/10.1126/science.aef8874',
		expectedDOI: '10.1126/science.aef8874',
		expectedSupplementCount: 0
	},
	{
		publisher: 'Science SI control',
		label: 'Atypon Journals',
		url: 'https://www.science.org/doi/10.1126/science.adt5229',
		expectedDOI: '10.1126/science.adt5229',
		expectedSupplementCount: 2
	},
	{
		publisher: 'Wiley requested (no published SI)',
		label: 'Wiley Online Library',
		url: 'https://analyticalsciencejournals.onlinelibrary.wiley.com/doi/10.1002/cbf.70276',
		expectedDOI: '10.1002/cbf.70276',
		expectedSupplementCount: 0
	},
	{
		publisher: 'Wiley SI control',
		label: 'Wiley Online Library',
		url: 'https://onlinelibrary.wiley.com/doi/10.1111/tpj.14950',
		expectedDOI: '10.1111/tpj.14950',
		expectedSupplementCount: 2
	}
];

const runLive = process.env.LIVE_PUBLISHER_TESTS === 'true' ? describe : describe.skip;
const supplementaryAsLink = process.env.LIVE_SUPPLEMENTARY_AS_LINK === 'true';
const expectPublisherFixes = process.env.EXPECT_PUBLISHER_FIXES === 'true';
const libraryTransfer = process.env.LIVE_LIBRARY_TRANSFER === 'true';
const attachmentFetchOnly = process.env.LIVE_ATTACHMENT_FETCH_ONLY === 'true';
const requirePrimaryPDF = process.env.LIVE_REQUIRE_PRIMARY_PDF === 'true';

async function stubLiveConnectorMethods(pingResponse) {
	if (!libraryTransfer) {
		return stubConnectorCallMethod({
			ping: { response: pingResponse },
			saveItems: { returnPayload: true },
			getSelectedCollection: { response: {} }
		});
	}

	await background((pingResponse) => {
		let callMethod = Zotero.Connector.callMethod;
		globalThis.__liveLibraryTransferCalls = [];
		sinon.stub(Zotero.Connector, 'callMethod').callsFake(async function(options, payload, ...args) {
			let method = typeof options === 'string' ? options : options.method;
			if (method === 'ping') return pingResponse;

			let call = { method };
			if (method === 'saveItems') {
				call.items = payload.items?.map(item => ({
					title: item.title,
					DOI: item.DOI
				}));
			}
			else if (method === 'saveAttachment') {
				try {
					call.attachment = JSON.parse(options.headers['X-Metadata']);
				}
				catch (e) {
					call.attachmentMetadataError = e.message;
				}
			}

			try {
				let response = await callMethod.call(this, options, payload, ...args);
				call.success = true;
				globalThis.__liveLibraryTransferCalls.push(call);
				return response;
			}
			catch (e) {
				call.success = false;
				call.error = e.message;
				call.status = e.status;
				globalThis.__liveLibraryTransferCalls.push(call);
				throw e;
			}
		});
	}, pingResponse);

	return () => background(() => {
		Zotero.Connector.callMethod.restore();
		delete globalThis.__liveLibraryTransferCalls;
	});
}

async function waitForDetection(tab, url) {
	await tab.navigate(url);
	let challengeWasPresent = await tab.runInPage(() => document.title === 'Just a moment...');
	if (challengeWasPresent) {
		try {
			await tab.page.waitForFunction(
				() => document.title !== 'Just a moment...',
				{ timeout: 45000 }
			);
			await tab.page.reload({ waitUntil: 'load' });
		}
		catch (e) {
			// Preserve the challenge page in the diagnostic output instead of
			// converting publisher bot protection into a translator failure.
		}
	}

	let emptyResult = null;
	for (let i = 0; i < 60; i++) {
		let translators = await background((tabId) => {
			let translatorInfo = Zotero.Connector_Browser._tabInfo[tabId]?.translators;
			if (!translatorInfo) return null;
			return translatorInfo.map(translator => ({
				translatorID: translator.translatorID,
				label: translator.label,
				priority: translator.priority,
				lastUpdated: translator.lastUpdated,
				target: translator.target
			}));
		}, tab.tabId);
		if (translators?.length) return translators;
		if (translators) emptyResult = translators;
		if (emptyResult && i >= 20) return emptyResult;
		await delay(250);
	}
	throw new Error(`Timed out waiting for translator detection on ${url}`);
}

async function inspectPage(tab) {
	return tab.runInPage(async () => {
		let doi = document.querySelector('meta[name="citation_doi"]')?.content || null;
		let acsDoiResolution = null;
		if (location.hostname === 'pubs.acs.org' && doi) {
			try {
				let response = await fetch(`/doi/${doi}`, { credentials: 'include' });
				acsDoiResolution = {
					status: response.status,
					url: response.url,
					redirected: response.redirected,
					contentType: response.headers.get('content-type')
				};
			}
			catch (e) {
				acsDoiResolution = { error: e.message };
			}
		}
		return {
			url: location.href,
			title: document.title,
			challengePage: document.title === 'Just a moment...',
			doi,
			pdf: document.querySelector('meta[name="citation_pdf_url"]')?.content || null,
			acsDoiResolution,
			acsModernSupplements: [...document.querySelectorAll('a[data-doctype="dataSupplementDoc"][href]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href })),
			acsLegacySupplementCount: document.querySelectorAll('.article_content-left .suppl-anchor').length,
			natureLegacySection: Boolean(document.getElementById('supplementary-information')),
			natureModernSupplements: [...document.querySelectorAll('[data-test="supp-item"] a[data-test="supp-info-link"][href]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href }))
				.filter(attachment => attachment.url.includes('media.springernature.com')),
			natureFigureLinks: document.querySelectorAll('[data-test="supp-item"] a[href*="/figures/"]').length,
			cellModernSupplements: [...document.querySelectorAll('#supplementary-material .core-supplementary-material .core-link a[href]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href })),
			cellLegacySupplementCount: document.querySelectorAll('#main_supp dl dt').length,
			rscModernSupplements: [...document.querySelectorAll('a[href*="/article-supplement/"]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href })),
			scienceModernSupplements: [...document.querySelectorAll('#supplementary-materials a[href*="/doi/suppl/"]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href })),
			wileyModernSupplements: [...document.querySelectorAll('a[href*="/action/downloadSupplement"]')]
				.map(link => ({ text: link.textContent.trim(), url: link.href }))
		};
	});
}

async function translate(tab, translatorLabel) {
	return background(async (tabId, label) => {
		let tabInfo = Zotero.Connector_Browser._tabInfo[tabId];
		let labels = Array.isArray(label) ? label : [label];
		let index = tabInfo?.translators?.findIndex(translator => labels.includes(translator.label)) ?? -1;
		if (index < 0) return null;
		let browserTab = await browser.tabs.get(tabId);
		let translator = tabInfo.translators[index];
		// Target the top frame directly. saveWithTranslator() broadcasts to all
		// frames, and ad frames on live sites can return before the article frame.
		return Zotero.Messaging.sendMessage(
			'translate',
			[tabInfo.instanceID, translator.translatorID, {}],
			browserTab,
			0
		);
	}, tab.tabId, translatorLabel);
}

function assertPublisherFix(testCase, result) {
	if (testCase.supplementPattern) {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		assert.isTrue(result.items[0].attachments.some(attachment =>
			attachment.mimeType === 'application/pdf' && testCase.primaryPattern.test(attachment.url)),
		'primary PDF descriptor is separate from SI');
		let supplements = result.items[0].attachments.filter(attachment => testCase.supplementPattern.test(attachment.url));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		if (supplementaryAsLink) assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		return;
	}
	if (testCase.publisher === 'ACS') {
		assert.equal(result.translators[0]?.label, 'ACS Publications');
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('/article-supplement/')
				|| attachment.url?.includes('ndownloader.figshare.com/files/'));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
	else if (testCase.publisher === 'Nature') {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, '10.1038/s41586-026-10843-7');
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('media.springernature.com/original/'));
		assert.lengthOf(supplements, 21);
		assert.lengthOf(supplements.filter(attachment => attachment.mimeType === 'application/pdf'), 3);
		assert.lengthOf(supplements.filter(attachment => attachment.mimeType
			=== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 18);
		assert.isFalse(supplements.some(attachment => /\/figures\/\d+/.test(attachment.url)));
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
	else if (testCase.publisher === 'Cell Press') {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('/attachment/')
				|| attachment.url?.includes('ars.els-cdn.com/content/image/'));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		assert.equal(new Set(supplements.map(attachment => attachment.url)).size, supplements.length);
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
	else if (testCase.publisher === 'RSC') {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		assert.isTrue(result.items[0].attachments.some(attachment =>
			attachment.url?.includes('/article-pdf/doi/')),
		'main RSC PDF descriptor was preserved');
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('/article-supplement/'));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		assert.isTrue(supplements.every(attachment => attachment.mimeType === 'video/mp4'));
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
	else if (testCase.publisher.startsWith('Science')) {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		assert.isTrue(result.items[0].attachments.some(attachment =>
			attachment.url?.includes('/doi/pdf/')),
		'main Science PDF descriptor was preserved');
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('/doi/suppl/'));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		if (testCase.expectedSupplementCount) {
			assert.sameMembers(supplements.map(attachment => attachment.mimeType), [
				'application/pdf',
				'application/zip'
			]);
		}
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
	else if (testCase.publisher.startsWith('Wiley')) {
		assert.lengthOf(result.items, 1);
		assertDOIEqual(result.items[0].DOI, testCase.expectedDOI);
		assert.isTrue(result.items[0].attachments.some(attachment =>
			attachment.url?.includes('/doi/pdfdirect/')),
		'main Wiley PDF descriptor was preserved');
		let supplements = result.items[0].attachments.filter(attachment =>
			attachment.url?.includes('/action/downloadSupplement'));
		assert.lengthOf(supplements, testCase.expectedSupplementCount);
		if (testCase.expectedSupplementCount) {
			assert.sameMembers(supplements.map(attachment => attachment.mimeType), [
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			]);
		}
		if (supplementaryAsLink) {
			assert.isTrue(supplements.every(attachment => attachment.snapshot === false));
		}
	}
}

function assertDOIEqual(actual, expected) {
	let normalize = doi => typeof doi === 'string' ? doi.trim().toLowerCase() : doi;
	assert.equal(normalize(actual), normalize(expected));
}

function assertLibraryTransfer(testCase, result) {
	let calls = result.libraryTransferCalls || [];
	assert.lengthOf(calls.filter(call => call.method === 'saveItems' && call.success), 1);
	let savedAttachments = calls.filter(call => call.method === 'saveAttachment' && call.success)
		.map(call => call.attachment);
	if (requirePrimaryPDF) {
		let primaryDescriptorURLs = new Set((result.items || [])
			.flatMap(item => item.attachments || [])
			.filter(attachment => attachment.title === 'Full Text PDF'
				&& attachment.mimeType === 'application/pdf')
			.map(attachment => normalizeAttachmentURL(attachment.url))
			.filter(Boolean));
		let primaryPDFs = savedAttachments.filter(attachment =>
			attachment.contentType === 'application/pdf'
				&& isPrimaryPDFURL(testCase, attachment.url)
				&& primaryDescriptorURLs.has(normalizeAttachmentURL(attachment.url)));
		assert.lengthOf(primaryPDFs, 1, 'primary article PDF was transferred');
	}
	if (testCase.supplementPattern) {
		assert.lengthOf(savedAttachments.filter(attachment => testCase.supplementPattern.test(attachment.url)),
			testCase.expectedSupplementCount);
	}
	else if (testCase.publisher === 'ACS') {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('/article-supplement/')
				|| attachment.url.includes('ndownloader.figshare.com/files/')),
		testCase.expectedSupplementCount);
	}
	else if (testCase.publisher === 'Nature') {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('media.springernature.com/original/')), 21);
	}
	else if (testCase.publisher === 'Cell Press') {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('/attachment/')
				|| attachment.url.includes('ars.els-cdn.com/content/image/')),
		testCase.expectedSupplementCount);
	}
	else if (testCase.publisher === 'RSC') {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('/article-supplement/')),
		testCase.expectedSupplementCount);
	}
	else if (testCase.publisher.startsWith('Science')) {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('/doi/suppl/')),
		testCase.expectedSupplementCount);
	}
	else if (testCase.publisher.startsWith('Wiley')) {
		assert.lengthOf(savedAttachments.filter(attachment =>
			attachment.url.includes('/action/downloadSupplement')),
		testCase.expectedSupplementCount);
	}
}

function normalizeAttachmentURL(url) {
	if (typeof url !== 'string' || !url) return null;
	try {
		let normalized = new URL(url);
		normalized.hash = '';
		return normalized.href;
	}
	catch (e) {
		return null;
	}
}

function isPrimaryPDFURL(testCase, url) {
	url = normalizeAttachmentURL(url);
	if (!url) return false;
	if (testCase.primaryPattern) return testCase.primaryPattern.test(url);
	if (testCase.publisher === 'ACS') {
		return /^https?:\/\/pubs\.acs\.org\/doi\/pdf\/[^?#]+(?:\?[^#]*)?$/i.test(url);
	}
	if (testCase.publisher === 'Nature') {
		return /^https?:\/\/(?:www\.)?nature\.com\/articles\/[^/?#]+\.pdf(?:\?[^#]*)?$/i.test(url);
	}
	if (testCase.publisher === 'Cell Press') {
		return /^https?:\/\/(?:www\.)?cell\.com\/[^?#]*\/pdf(?:\/[^?#]*)?(?:\?[^#]*)?$/i.test(url);
	}
	if (testCase.publisher === 'RSC') {
		return /^https?:\/\/[^/?#]+\/[^?#]*\/article-pdf\/doi\//i.test(url);
	}
	if (testCase.publisher.startsWith('Science')) {
		return /^https?:\/\/[^/?#]+\/doi\/pdf\/[^?#]+(?:\?[^#]*)?$/i.test(url);
	}
	if (testCase.publisher.startsWith('Wiley')) {
		return /^https?:\/\/[^/?#]+\/doi\/pdfdirect\/[^?#]+(?:\?[^#]*)?$/i.test(url);
	}
	return false;
}

describe('Live publisher transfer URL classification', function () {
	it('distinguishes main PDFs from publisher supplementary routes', function () {
		let cases = [
			{
				publisher: 'ACS',
				primary: 'https://pubs.acs.org/doi/pdf/10.1021/example',
				supplement: 'https://pubs.acs.org/article-supplement/example/file.pdf',
			},
			{
				publisher: 'Nature',
				primary: 'https://www.nature.com/articles/example.pdf',
				supplement: 'https://media.springernature.com/original/example.pdf',
			},
			{
				publisher: 'Cell Press',
				primary: 'https://www.cell.com/cell/pdf/example.pdf?download=true',
				supplement: 'https://ars.els-cdn.com/content/image/example.pdf',
			},
			{
				publisher: 'RSC',
				primary: 'https://pubs.rsc.org/en/content/article-pdf/doi/example',
				supplement: 'https://pubs.rsc.org/en/content/article-supplement/doi/example/file.mp4',
			},
			{
				publisher: 'Science SI control',
				primary: 'https://www.science.org/doi/pdf/example',
				supplement: 'https://www.science.org/doi/suppl/example/file.pdf',
			},
			{
				publisher: 'Wiley SI control',
				primary: 'https://onlinelibrary.wiley.com/doi/pdfdirect/example',
				supplement: 'https://onlinelibrary.wiley.com/action/downloadSupplement?file=example.pdf',
			},
		];
		for (let rollout of CASES.filter(testCase => testCase.supplementPattern)) {
			let primary = rollout.publisher.startsWith('Molecules') ? rollout.url + '/pdf'
				: rollout.publisher.startsWith('Catalysts') ? rollout.url + '/pdf'
					: rollout.publisher.startsWith('Materials') ? 'https://link.springer.com/content/pdf/10.1007/s10853-025-11859-6.pdf'
						: 'https://www.frontiersin.org/articles/10.3389/fchem.2021.685783/pdf';
			assert.isTrue(isPrimaryPDFURL(rollout, primary), rollout.publisher);
			assert.isFalse(isPrimaryPDFURL(rollout, 'https://example.invalid/supplement.pdf'), rollout.publisher);
		}
		for (let testCase of cases) {
			assert.isTrue(isPrimaryPDFURL(testCase, testCase.primary), testCase.publisher);
			assert.isFalse(isPrimaryPDFURL(testCase, testCase.supplement), testCase.publisher);
		}
		assert.isFalse(isPrimaryPDFURL({ publisher: 'Nature' }, ''), 'Nature empty URL');
		assert.isFalse(isPrimaryPDFURL(
			{ publisher: 'Nature' },
			'https://example.invalid/article.pdf'
		), 'Nature unrelated URL');
		assert.isFalse(isPrimaryPDFURL({ publisher: 'Cell Press' }, ''), 'Cell empty URL');
		assert.isFalse(isPrimaryPDFURL(
			{ publisher: 'Cell Press' },
			'https://ars.els-cdn.com/content/image/example.pdf'
		), 'Cell supplementary URL');
	});

	it('accepts DOI values with different case', function () {
		assertDOIEqual('10.1039/d6ma00514d', '10.1039/D6MA00514D');
	});
});

runLive('Live publisher translator diagnostics', function () {
	this.timeout(120000);

	let restoreConnectorCallMethod;

	before(async function () {
		if (libraryTransfer) {
			assert.equal(process.env.LIVE_CONNECTOR_URL, 'http://127.0.0.1:23129/', 'live transfers require the explicit disposable endpoint');
			await background(async endpoint => Zotero.Prefs.set('connector.url', endpoint), process.env.LIVE_CONNECTOR_URL);
		}
		await seedTranslatorPrefs(
			worker,
			PUBLISHER_TRANSLATOR_IDS,
			process.env.PUBLISHER_TRANSLATOR_REVISION || null
		);
		let seededTranslators = await background(async (translatorIDs) => Promise.all(
			translatorIDs.map(async (translatorID) => {
				let translator = await Zotero.Translators.getWithoutCode(translatorID);
				return {
					translatorID,
					lastUpdated: translator.lastUpdated,
					target: translator.target,
					codeLastUpdated: JSON.parse(translator.code.match(/^\s*{[\s\S]*?}\s*?[\r\n]/)[0]).lastUpdated
				};
			})
		), PUBLISHER_TRANSLATOR_IDS);
		console.log(`LIVE_SEEDED_TRANSLATORS ${JSON.stringify(seededTranslators)}`);
		await background(async (supplementaryAsLink) => {
			sinon.stub(Zotero.Connector, 'checkIsOnline').resolves(true);
			Zotero.Connector._processTranslatorPreferences({
				translatorPrefsVersion: 1,
				translatorPrefs: {
					attachSupplementary: true,
					supplementaryAsLink
				}
			});
			await Zotero.OffscreenManager.sendMessage('Prefs.loadNamespace', ['translators.']);
		}, supplementaryAsLink);
		let [backgroundPref, offscreenPref] = await Promise.all([
			background(() => Zotero.Prefs.get('translators.attachSupplementary')),
			offscreen(() => Zotero.Prefs.get('translators.attachSupplementary'))
		]);
		assert.isTrue(backgroundPref);
		assert.isTrue(offscreenPref);
		// Keep translator selection isolated from the user's cached translator
		// versions while optionally allowing saveItems/saveAttachment through to
		// the running Zotero client for an explicitly requested library transfer.
		restoreConnectorCallMethod = await stubLiveConnectorMethods({
			prefs: {
				downloadAssociatedFiles: true,
				translatorPrefsVersion: 1,
				translatorPrefs: {
					attachSupplementary: true,
					supplementaryAsLink
				}
			}
		});
	});

	after(async function () {
		if (restoreConnectorCallMethod) await restoreConnectorCallMethod();
		await background(async () => {
			if (Zotero.Connector.checkIsOnline.restore) Zotero.Connector.checkIsOnline.restore();
			Zotero.Connector._processTranslatorPreferences();
			await Zotero.OffscreenManager.sendMessage('Prefs.loadNamespace', ['translators.']);
		});
	});

	for (let testCase of CASES) {
		it(testCase.publisher, async function () {
			let tab = new Tab();
			let restoreHTTP;
			await tab.init('about:blank');
			if (libraryTransfer) {
				await background(() => {
					globalThis.__liveLibraryTransferCalls = [];
				});
			}
			try {
				let translators = await waitForDetection(tab, testCase.url);
				let seededAfterDetection = await background(async (translatorID) => {
					let translator = await Zotero.Translators.getWithoutCode(translatorID);
					return {
						lastUpdated: translator?.lastUpdated,
						codeLastUpdated: translator?.code
							? JSON.parse(translator.code.match(/^\s*{[\s\S]*?}\s*?[\r\n]/)[0]).lastUpdated
							: null
					};
				}, Array.isArray(testCase.label)
					? PUBLISHER_TRANSLATOR_IDS[0]
					: translators.find(translator => translator.label === testCase.label)?.translatorID);
				let page = await inspectPage(tab);
				if (testCase.publisher === 'Cell Press' && page.pdf
						&& process.env.PUBLISHER_TRANSLATOR_REVISION) {
					restoreHTTP = await stubHTTPRequest({ [page.pdf]: {} });
				}
				if (attachmentFetchOnly) {
					let urls;
					if (testCase.publisher === 'Cell Press') {
						let pii = page.url.match(/\/(?:abstract|fulltext)\/(S[^/?#]+)/i)?.[1]
							.replace(/[^a-z0-9]/gi, '');
						urls = page.cellModernSupplements.map(attachment =>
							'https://ars.els-cdn.com/content/image/1-s2.0-'
								+ pii + '-' + attachment.url.split('/').pop());
					}
					else {
						urls = process.env.LIVE_ATTACHMENT_FETCH_URL
							? [process.env.LIVE_ATTACHMENT_FETCH_URL]
							: page.acsModernSupplements.slice(0, 1).map(attachment => attachment.url);
					}
					assert.isAbove(urls.length, 0, 'Supplementary URL is present');
					let fetchResults = await background(async (tabId, referrer, urls) => {
						let browserTab = await browser.tabs.get(tabId);
						let results = [];
						for (let url of urls) {
							let attachment = { url, referrer, mimeType: 'application/pdf' };
							let data = await Zotero.ItemSaver._fetchAttachment(attachment, browserTab);
							results.push({ byteLength: data.byteLength, finalURL: attachment.url });
						}
						return results;
					}, tab.tabId, page.url, urls);
					console.log(`LIVE_ATTACHMENT_FETCH_RESULT ${JSON.stringify(fetchResults)}`);
					assert.isTrue(fetchResults.every(result => result.byteLength > 0));
					return;
				}
				let items = await translate(tab, testCase.label);
				let libraryTransferCalls = libraryTransfer
					? await background(() => globalThis.__liveLibraryTransferCalls)
					: null;
				let result = {
					publisher: testCase.publisher,
					translators,
					seededAfterDetection,
					page,
					libraryTransferCalls,
					items: items?.map(item => ({
						title: item.title,
						DOI: item.DOI,
						url: item.url,
						attachments: item.attachments?.map(attachment => ({
							title: attachment.title,
							url: attachment.url,
							mimeType: attachment.mimeType,
							snapshot: attachment.snapshot
						}))
					})) || null
				};
				console.log(`LIVE_PUBLISHER_RESULT ${JSON.stringify(result)}`);
				if (expectPublisherFixes) assertPublisherFix(testCase, result);
				if (libraryTransfer) assertLibraryTransfer(testCase, result);
			}
			finally {
				if (restoreHTTP) await restoreHTTP();
				await tab.close();
			}
		});
	}
});
