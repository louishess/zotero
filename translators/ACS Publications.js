{
	"translatorID": "938ebe32-2b2e-4349-a5b3-b3a05d3de627",
	"label": "ACS Publications",
	"creator": "Sean Takats, Michael Berkowitz, Santawort, and Aurimas Vinckevicius",
	"target": "^https?://pubs\\.acs\\.org/(toc/|journal/|topic/|isbn/\\d|doi/(full/|abs/|epdf/|book/)?10\\.|action/(doSearch\\?|showCitFormats\\?.*doi)|[^/?#]+/(article(-abstract|-split)?|issue)(/|$))",
	"minVersion": "4.0.5",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-09-06 00:00:00"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2008 Sean Takats, Michael Berkowitz, Santawort, Aurimas
	Vinckevicius, Philipp Zumstein, and other contributors.

	This file is part of Zotero.

	Zotero is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	Zotero is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with Zotero. If not, see <http://www.gnu.org/licenses/>.

	***** END LICENSE BLOCK *****
*/

function getSearchResults(doc, checkOnly) {
	var items = {}, found = false;
	var rows = doc.querySelectorAll([
		'.issue-item_title a',
		'.teaser_title a',
		'#ArticleList h5.item-title > a',
		'.al-title a[href*="/article"]',
		'.al-article-items > .customLink > a[href*="/article"]'
	].join(', '));
	for (let i = 0; i < rows.length; i++) {
		var href = rows[i].href;
		var title = ZU.trimInternal(text(rows[i], '.access-title') || rows[i].textContent);
		if (!href || !title) continue;
		let path = new URL(href).pathname;
		if (!getDoi(href) && !/\/article(?:-abstract|-split)?\//.test(path)) continue;
		if (checkOnly) return true;
		found = true;
		items[href] = title;
	}
	
	return found ? items : false;
}

// Return the DOI indicated by the page metadata or URL, or null when no DOI is found.
// The URL should be properly encoded.
function getDoi(url, doc) {
	let metaDOI = doc && attr(doc, 'meta[name="citation_doi"]', 'content');
	if (metaDOI) {
		return metaDOI.trim().replace(/^doi:\s*/i, '');
	}
	let urlObj = new URL(url);
	let doi = decodeURIComponent(urlObj.pathname).match(/^\/doi\/(?:.+\/)?(10\.\d{4,}\/.+)$/);
	if (doi) {
		doi = doi[1];
	}
	else {
		doi = urlObj.searchParams.get("doi");
	}
	return doi;
}

function isSilverchairArticle(doc, url) {
	let pageURL = doc && doc.location && doc.location.href || url;
	return /\/[^/]+\/article(?:-abstract|-split)?\//.test(new URL(pageURL).pathname)
		&& Boolean(getDoi(pageURL, doc));
}

/** ***************************
 * BEGIN: Supplementary data *
 *****************************/

var suppTypeMap = {
	txt: 'text/plain',
	csv: 'text/csv',
	bz2: 'application/x-bzip2',
	gz: 'application/gzip',
	zip: 'application/zip',
	pdf: 'application/pdf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	mp4: 'video/mp4'
};

function getPageSupplements(doc, supplementAsLink = false) {
	let supplements = [];
	let seenURLs = new Set();
	let supplementLinks = doc.querySelectorAll([
		'a[data-doctype="dataSupplementDoc"][href]',
		'.article_content-left .suppl-anchor[href]'
	].join(', '));
	for (let i = 0; i < supplementLinks.length; i++) {
		let elem = supplementLinks[i];
		let url = elem.href;
		if (!url || seenURLs.has(url)) continue;
		seenURLs.add(url);

		let pathname = new URL(url).pathname;
		let formatMatch = pathname.match(/\/article-supplement\/[^/]+\/([^/]+)\//);
		let extensionMatch = pathname.match(/\.([^./]+)$/);
		let ext = (formatMatch && formatMatch[1]
			|| extensionMatch && extensionMatch[1]
			|| '').toLowerCase();
		let mimeType = suppTypeMap[ext];
		// Only save file when MIME type is known *and* when we aren't
		// specifically told otherwise
		let snapshot = Boolean(!supplementAsLink && mimeType);
		// The "title" (text describing what the supplement file is for) can be
		// substantially long, while the filename is redundant (and it doesn't
		// inform the user that the file is meant to be a supplement). We
		// simply number them in the order they appear.
		let title = `Supplement ${supplements.length + 1}`;
		let attachment = { title, url, snapshot };
		if (mimeType) attachment.mimeType = mimeType;
		supplements.push(attachment);
	}
	return supplements;
}

async function getFigshareSupplements(doi) {
	let normalizedDOI = doi.toLowerCase();
	let records = await requestJSON('https://api.figshare.com/v2/articles/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ resource_doi: doi }) // eslint-disable-line camelcase
	});
	if (!Array.isArray(records)) {
		Z.debug(`ACS Publications: malformed Figshare supplementary response for ${doi}; preserving page supplements`);
		return null;
	}
	let matchedRecords = records.filter(record => record && typeof record.resource_doi === 'string'
		&& record.resource_doi.toLowerCase() === normalizedDOI);
	if (matchedRecords.length > 2) {
		Z.debug(`ACS Publications: Figshare supplementary record limit reached for ${doi}; preserving page supplements`);
		return null;
	}
	if (matchedRecords.some(record => typeof record.doi !== 'string' || !isFigshareArticleURL(record.url))) {
		Z.debug(`ACS Publications: malformed Figshare supplementary record for ${doi}; preserving page supplements`);
		return null;
	}
	let seenDetailURLs = new Set();
	matchedRecords = matchedRecords.filter((record) => {
		if (seenDetailURLs.has(record.url)) return false;
		seenDetailURLs.add(record.url);
		return true;
	});
	matchedRecords.sort((a, b) => {
		let aNumber = parseInt((a.doi.match(/\.s(\d+)$/i) || [])[1]) || 0;
		let bNumber = parseInt((b.doi.match(/\.s(\d+)$/i) || [])[1]) || 0;
		return aNumber - bNumber;
	});

	let details = await Promise.all(matchedRecords.map(record => requestJSON(record.url)));
	let supplements = [];
	let seenURLs = new Set();
	for (let detail of details) {
		if (!detail || typeof detail !== 'object' || !Array.isArray(detail.files)
			|| (detail.resource_doi && (typeof detail.resource_doi !== 'string'
			|| detail.resource_doi.toLowerCase() !== normalizedDOI))) {
			Z.debug(`ACS Publications: malformed Figshare supplementary detail for ${doi}; preserving page supplements`);
			return null;
		}
		for (let file of detail.files || []) {
			if (!file || typeof file.download_url !== 'string' || seenURLs.has(file.download_url)) continue;
			seenURLs.add(file.download_url);
			let extension = typeof file.name === 'string' && file.name.match(/\.([^.]+)$/);
			let mimeType = (typeof file.mimetype === 'string' && file.mimetype)
				|| extension && suppTypeMap[extension[1].toLowerCase()];
			let attachment = {
				title: `Supplement ${supplements.length + 1}`,
				url: file.download_url,
				snapshot: Boolean(mimeType)
			};
			if (mimeType) attachment.mimeType = mimeType;
			supplements.push(attachment);
		}
	}
	return supplements;
}

function isFigshareArticleURL(url) {
	try {
		let urlObj = new URL(url);
		return (urlObj.protocol === 'http:' || urlObj.protocol === 'https:')
			&& urlObj.hostname === 'api.figshare.com'
			&& !urlObj.username && !urlObj.password && !urlObj.port
			&& /^\/v2\/articles\/\d+$/.test(urlObj.pathname)
			&& !urlObj.search && !urlObj.hash;
	}
	catch (e) {
		return false;
	}
}

async function getSupplements(doc, doi, supplementAsLink = false) {
	let pageSupplements = getPageSupplements(doc, supplementAsLink);
	if (supplementAsLink || !doi) return pageSupplements;

	try {
		let figshareSupplements = await getFigshareSupplements(doi);
		if (figshareSupplements && figshareSupplements.length) return figshareSupplements;
	}
	catch (e) {
		Z.debug(`ACS Publications: Figshare supplementary lookup failed for ${doi}`);
		Z.debug(e);
	}
	return pageSupplements;
}

/** *************************
 * END: Supplementary data *
 ***************************/

function detectWeb(doc, url) {
	if (isSilverchairArticle(doc, url)) {
		return "journalArticle";
	}
	if (getSearchResults(doc, true)) {
		return "multiple";
	}
	let urlObj = new URL(url);
	// standalone "download citation" page
	if (urlObj.pathname === "/action/showCitFormats"
		&& urlObj.searchParams.get("doi")) {
		// May be inaccurate, but better than not detecting
		return "journalArticle";
	}
	// epdf viewer web app
	if (urlObj.pathname.startsWith("/doi/epdf/")) {
		// TODO: check if "epdf" viewer is always for journal articles
		return "journalArticle";
	}
	// books such as https://pubs.acs.org/doi/book/10.1021/acsguide
	if (urlObj.pathname.startsWith("/doi/book/")) {
		return "book";
	}
	if (doc.querySelector("#returnToBook")) {
		// Some of them may be conference articles, but the RIS doesn't say so
		return "bookSection";
	}
	else if (getDoi(url)) {
		// TODO: check if this block still works
		var type = doc.getElementsByClassName("content-navigation__contentType");
		if (type.length && type[0].textContent.includes("Chapter")) {
			return "bookSection";
		}
		else {
			return "journalArticle";
		}
	}
	return false;
}

function cleanNumberField(item, field) {
	if (item[field]) {
		let n = parseInt(item[field]);
		if (n <= 0 || isNaN(n)) {
			delete item[field];
		}
	}
}

async function doWeb(doc, url) {
	let attachSupplement = false;
	let supplementAsLink = false;
	// reduce some overhead by fetching these only once
	if (Z.getHiddenPref) {
		attachSupplement = Z.getHiddenPref("attachSupplementary");
		supplementAsLink = Z.getHiddenPref("supplementaryAsLink");
	}
	
	if (detectWeb(doc, url) == "multiple") { // search
		let items = await Z.selectItems(getSearchResults(doc));
		if (!items) return;
		for (let url of Object.keys(items)) {
			let articleDoc = attachSupplement || /\/article(?:-abstract|-split)?\//.test(new URL(url).pathname)
				? await requestDocument(url)
				: null;
			await scrape(articleDoc, url, { attachSupplement, supplementAsLink });
			await delay(500);
		}
	}
	else {
		// single article
		let articleDoc = isSilverchairArticle(doc, url) || attachSupplement ? doc : null;
		await scrape(articleDoc, url, { attachSupplement, supplementAsLink });
	}
}

function delay(milliseconds) {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function scrape(doc, url, options) {
	if (isSilverchairArticle(doc, url)) {
		await scrapeSilverchair(doc, url, options);
		return;
	}
	await scrapeLegacy(doc, url, options);
}

async function scrapeSilverchair(doc, url, options) {
	let pageURL = doc.location && doc.location.href || url;
	let doi = getDoi(pageURL, doc);
	// Keep the established ACS PDF route. It redirects to the current
	// Silverchair article PDF while retaining the browser's ACS session.
	let pdfURL = `/doi/pdf/${doi}`;
	let supplements = options.attachSupplement
		? await getSupplements(doc, doi, options.supplementAsLink)
		: [];

	let translator = Zotero.loadTranslator('web');
	// Embedded Metadata. Silverchair's RIS endpoint rejects Connector requests.
	translator.setTranslator('951c027d-74ac-47d4-a107-9c3069ab7b48');
	translator.setDocument(doc);
	translator.setHandler('itemDone', function (obj, item) {
		item.DOI = doi;
		item.url = `https://doi.org/${doi}`;
		item.libraryCatalog = 'ACS Publications';
		item.attachments = [];
		if (pdfURL) {
			item.attachments.push({
				title: 'Full Text PDF',
				url: new URL(pdfURL, pageURL).href,
				mimeType: 'application/pdf'
			});
		}
		item.attachments.push(...supplements);
		cleanNumberField(item, 'numberOfVolumes');
		cleanNumberField(item, 'numPages');
		item.complete();
	});
	await translator.translate();
}

async function scrapeLegacy(doc, url, options) {
	let doi = getDoi(url, doc);

	if (doc && /\/action\/showCitFormats\?|\/doi\/epdf\//.test(url)) {
		// standalone "export citation" page or "epdf viewer", *and*
		// supplements are desired; we need to fetch the actual article page
		// and scrape that
		url = `https://pubs.acs.org/doi/${doi}`;
		doc = await requestDocument(url);
	}
	let supplements = doc && options.attachSupplement
		? await getSupplements(doc, doi, options.supplementAsLink)
		: [];

	let risURL = new URL("/action/downloadCitation?include=abs&format=ris&direct=true", url);
	risURL.searchParams.set("doi", doi);
	risURL.searchParams.set("downloadFileName", doi.replace(/^10\.\d{4,}\//, ""));
	let risText = await requestText(risURL.href, { headers: { Referer: url } });
	// Delete redundant DOI info
	risText = risText.replace(/\nN1 {2}- doi:[^\n]+/, "");
	// Fix noise in DO field
	risText = risText.replace("\nDO  - doi:", "\nDO  - ");
	// Fix the wrong mapping for journal abbreviations
	risText = risText.replace("\nJO  -", "\nJ2  -");
	// Use publication date when available
	if (risText.includes("\nDA  -")) {
		risText = risText.replace(/\nY1 {2}- [^\n]*/, "")
			.replace("\nDA  -", "\nY1  -");
	}

	let translator = Zotero.loadTranslator("import");
	// RIS
	translator.setTranslator("32d59d2d-b65a-4da4-b0a3-bdd3cfb979e7");
	translator.setString(risText);
	translator.setHandler("itemDone", function (obj, item) {
		if (item.date) {
			item.date = ZU.strToISO(item.date);
		}
		item.attachments = [];
		if (/\/doi\/book\//.test(url)) {
			// books as standalone items don't have full pdfs (TODO: verify)
			if (doc) {
				item.attachments.push({
					title: "Snapshot",
					url: url,
					mimeType: "text/html"
				});
			}
		}
		else {
			// standard pdf
			item.attachments.push({
				title: "Full Text PDF",
				url: `/doi/pdf/${doi}`,
				mimeType: "application/pdf"
			});
		}
		// supplements
		item.attachments.push(...supplements);
		// Cleanup fields that may contain invalid numeric values
		cleanNumberField(item, "numberOfVolumes");
		cleanNumberField(item, "numPages");
		item.complete();
	});
	await translator.translate();
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://pubs.acs.org/doi/10.1021/es103607c",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Life Cycle Environmental Assessment of Lithium-Ion and Nickel Metal Hydride Batteries for Plug-In Hybrid and Battery Electric Vehicles",
				"creators": [
					{
						"lastName": "Majeau-Bettez",
						"firstName": "Guillaume",
						"creatorType": "author"
					},
					{
						"lastName": "Hawkins",
						"firstName": "Troy R.",
						"creatorType": "author"
					},
					{
						"lastName": "Strømman",
						"firstName": "Anders Hammer",
						"creatorType": "author"
					}
				],
				"date": "2011-05-15",
				"DOI": "10.1021/es103607c",
				"ISSN": "0013-936X",
				"abstractNote": "This study presents the life cycle assessment (LCA) of three batteries for plug-in hybrid and full performance battery electric vehicles. A transparent life cycle inventory (LCI) was compiled in a component-wise manner for nickel metal hydride (NiMH), nickel cobalt manganese lithium-ion (NCM), and iron phosphate lithium-ion (LFP) batteries. The battery systems were investigated with a functional unit based on energy storage, and environmental impacts were analyzed using midpoint indicators. On a per-storage basis, the NiMH technology was found to have the highest environmental impact, followed by NCM and then LFP, for all categories considered except ozone depletion potential. We found higher life cycle global warming emissions than have been previously reported. Detailed contribution and structural path analyses allowed for the identification of the different processes and value-chains most directly responsible for these emissions. This article contributes a public and detailed inventory, which can be easily be adapted to any powertrain, along with readily usable environmental performance assessments.",
				"issue": "10",
				"journalAbbreviation": "Environ. Sci. Technol.",
				"libraryCatalog": "ACS Publications",
				"pages": "4548-4554",
				"publicationTitle": "Environmental Science & Technology",
				"url": "https://doi.org/10.1021/es103607c",
				"volume": "45",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/toc/nalefd/12/6",
		"items": "multiple"
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/nalefd/issue/12/6",
		"items": "multiple"
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/doi/abs/10.1021/bk-2011-1071.ch005",
		"items": [
			{
				"itemType": "bookSection",
				"title": "Redox Chemistry and Natural Organic Matter (NOM): Geochemists’ Dream, Analytical Chemists’ Nightmare",
				"creators": [
					{
						"lastName": "Macalady",
						"firstName": "Donald L.",
						"creatorType": "author"
					},
					{
						"lastName": "Walton-Day",
						"firstName": "Katherine",
						"creatorType": "author"
					}
				],
				"date": "2011-01-01",
				"ISBN": "9780841226524",
				"abstractNote": "Natural organic matter (NOM) is an inherently complex mixture of polyfunctional organic molecules. Because of their universality and chemical reversibility, oxidation/reductions (redox) reactions of NOM have an especially interesting and important role in geochemistry. Variabilities in NOM composition and chemistry make studies of its redox chemistry particularly challenging, and details of NOM-mediated redox reactions are only partially understood. This is in large part due to the analytical difficulties associated with NOM characterization and the wide range of reagents and experimental systems used to study NOM redox reactions. This chapter provides a summary of the ongoing efforts to provide a coherent comprehension of aqueous redox chemistry involving NOM and of techniques for chemical characterization of NOM. It also describes some attempts to confirm the roles of different structural moieties in redox reactions. In addition, we discuss some of the operational parameters used to describe NOM redox capacities and redox states, and describe nomenclature of NOM redox chemistry. Several relatively facile experimental methods applicable to predictions of the NOM redox activity and redox states of NOM samples are discussed, with special attention to the proposed use of fluorescence spectroscopy to predict relevant redox characteristics of NOM samples.",
				"bookTitle": "Aquatic Redox Chemistry",
				"extra": "DOI: 10.1021/bk-2011-1071.ch005",
				"libraryCatalog": "ACS Publications",
				"pages": "85-111",
				"publisher": "American Chemical Society",
				"series": "ACS Symposium Series",
				"seriesNumber": "1071",
				"shortTitle": "Redox Chemistry and Natural Organic Matter (NOM)",
				"url": "https://doi.org/10.1021/bk-2011-1071.ch005",
				"volume": "1071",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/doi/abs/10.1021/jp000606%2B",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Theory of Charge Transport in Polypeptides",
				"creators": [
					{
						"lastName": "Schlag",
						"firstName": "E. W.",
						"creatorType": "author"
					},
					{
						"lastName": "Sheu",
						"firstName": "Sheh-Yi",
						"creatorType": "author"
					},
					{
						"lastName": "Yang",
						"firstName": "Dah-Yen",
						"creatorType": "author"
					},
					{
						"lastName": "Selzle",
						"firstName": "H. L.",
						"creatorType": "author"
					},
					{
						"lastName": "Lin",
						"firstName": "S. H.",
						"creatorType": "author"
					}
				],
				"date": "2000-08-01",
				"DOI": "10.1021/jp000606+",
				"ISSN": "1520-6106",
				"abstractNote": "We have derived phase space and diffusion theories for a new hopping model of charge transport in polypeptides and thence for distal chemical kinetics. The charge is transferred between two carbamide groups on each side of the Cα atom hinging two amino acid groups. When the torsional angles on the hinge approach a certain region of the Ramachandran plot, the charge transfer has zero barrier height and makes charge transfer the result of strong electronic correlation. The mean first passage time calculated from this analytic model of some 164 fs is in reasonable agreement with prior molecular dynamics calculation of some 140 fs and supports this new bifunctional model for charge transport and chemical reactions in polypeptides.",
				"issue": "32",
				"journalAbbreviation": "J. Phys. Chem. B",
				"libraryCatalog": "ACS Publications",
				"pages": "7790-7794",
				"publicationTitle": "The Journal of Physical Chemistry B",
				"url": "https://doi.org/10.1021/jp000606+",
				"volume": "104",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/journal/acbcct",
		"items": "multiple"
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/action/doSearch?text1=zotero&field1=AllField",
		"items": "multiple"
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/doi/book/10.1021/acsguide",
		"items": [
			{
				"itemType": "book",
				"title": "The ACS Guide to Scholarly Communication",
				"creators": [
					{
						"lastName": "Banik",
						"firstName": "Gregory M.",
						"creatorType": "author"
					},
					{
						"lastName": "Baysinger",
						"firstName": "Grace",
						"creatorType": "author"
					},
					{
						"lastName": "Kamat",
						"firstName": "Prashant V.",
						"creatorType": "author"
					},
					{
						"lastName": "Pienta",
						"firstName": "Norbert",
						"creatorType": "author"
					}
				],
				"date": "2019-10-02",
				"ISBN": "9780841235861",
				"extra": "DOI: 10.1021/acsguide",
				"libraryCatalog": "ACS Publications",
				"publisher": "American Chemical Society",
				"series": "ACS Guide to Scholarly Communication",
				"url": "https://doi.org/10.1021/acsguide",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/action/showCitFormats?doi=10.1021%2Facscentsci.3c00243",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Generic Platform for the Multiplexed Targeted Electrochemical Detection of Osteoporosis-Associated Single Nucleotide Polymorphisms Using Recombinase Polymerase Solid-Phase Primer Elongation and Ferrocene-Modified Nucleoside Triphosphates",
				"creators": [
					{
						"lastName": "Ortiz",
						"firstName": "Mayreli",
						"creatorType": "author"
					},
					{
						"lastName": "Jauset-Rubio",
						"firstName": "Miriam",
						"creatorType": "author"
					},
					{
						"lastName": "Trummer",
						"firstName": "Olivia",
						"creatorType": "author"
					},
					{
						"lastName": "Foessl",
						"firstName": "Ines",
						"creatorType": "author"
					},
					{
						"lastName": "Kodr",
						"firstName": "David",
						"creatorType": "author"
					},
					{
						"lastName": "Acero",
						"firstName": "Josep Lluís",
						"creatorType": "author"
					},
					{
						"lastName": "Botero",
						"firstName": "Mary Luz",
						"creatorType": "author"
					},
					{
						"lastName": "Biggs",
						"firstName": "Phil",
						"creatorType": "author"
					},
					{
						"lastName": "Lenartowicz",
						"firstName": "Daniel",
						"creatorType": "author"
					},
					{
						"lastName": "Trajanoska",
						"firstName": "Katerina",
						"creatorType": "author"
					},
					{
						"lastName": "Rivadeneira",
						"firstName": "Fernando",
						"creatorType": "author"
					},
					{
						"lastName": "Hocek",
						"firstName": "Michal",
						"creatorType": "author"
					},
					{
						"lastName": "Obermayer-Pietsch",
						"firstName": "Barbara",
						"creatorType": "author"
					},
					{
						"lastName": "O’Sullivan",
						"firstName": "Ciara K.",
						"creatorType": "author"
					}
				],
				"date": "2023-08-23",
				"DOI": "10.1021/acscentsci.3c00243",
				"ISSN": "2374-7943",
				"abstractNote": "Osteoporosis is a multifactorial disease influenced by genetic and environmental factors, which contributes to an increased risk of bone fracture, but early diagnosis of this disease cannot be achieved using current techniques. We describe a generic platform for the targeted electrochemical genotyping of SNPs identified by genome-wide association studies to be associated with a genetic predisposition to osteoporosis. The platform exploits isothermal solid-phase primer elongation with ferrocene-labeled nucleoside triphosphates. Thiolated reverse primers designed for each SNP were immobilized on individual gold electrodes of an array. These primers are designed to hybridize to the SNP site at their 3′OH terminal, and primer elongation occurs only where there is 100% complementarity, facilitating the identification and heterozygosity of each SNP under interrogation. The platform was applied to real blood samples, which were thermally lysed and directly used without the need for DNA extraction or purification. The results were validated using Taqman SNP genotyping assays and Sanger sequencing. The assay is complete in just 15 min with a total cost of 0.3€ per electrode. The platform is completely generic and has immense potential for deployment at the point of need in an automated device for targeted SNP genotyping with the only required end-user intervention being sample addition.",
				"issue": "8",
				"journalAbbreviation": "ACS Cent. Sci.",
				"libraryCatalog": "ACS Publications",
				"pages": "1591-1602",
				"publicationTitle": "ACS Central Science",
				"url": "https://doi.org/10.1021/acscentsci.3c00243",
				"volume": "9",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "https://pubs.acs.org/doi/epdf/10.1021/acscentsci.3c00323",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Dynamics of Rayleigh Fission Processes in ∼100 nm Charged Aqueous Nanodrops",
				"creators": [
					{
						"lastName": "Hanozin",
						"firstName": "Emeline",
						"creatorType": "author"
					},
					{
						"lastName": "Harper",
						"firstName": "Conner C.",
						"creatorType": "author"
					},
					{
						"lastName": "McPartlan",
						"firstName": "Matthew S.",
						"creatorType": "author"
					},
					{
						"lastName": "Williams",
						"firstName": "Evan R.",
						"creatorType": "author"
					}
				],
				"date": "2023-08-23",
				"DOI": "10.1021/acscentsci.3c00323",
				"ISSN": "2374-7943",
				"abstractNote": "Fission of micron-size charged droplets has been observed using optical methods, but little is known about fission dynamics and breakup of smaller nanosize droplets that are important in a variety of natural and industrial processes. Here, spontaneous fission of individual aqueous nanodrops formed by electrospray is investigated using charge detection mass spectrometry. Fission processes ranging from formation of just two progeny droplets in 2 ms to production of dozens of progeny droplets over 100+ ms are observed for nanodrops that are charged above the Rayleigh limit. These results indicate that Rayleigh fission is a continuum of processes that produce progeny droplets that vary widely in charge, mass, and number.",
				"issue": "8",
				"journalAbbreviation": "ACS Cent. Sci.",
				"libraryCatalog": "ACS Publications",
				"pages": "1611-1622",
				"publicationTitle": "ACS Central Science",
				"url": "https://doi.org/10.1021/acscentsci.3c00323",
				"volume": "9",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					}
				],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	}
]
/** END TEST CASES **/
