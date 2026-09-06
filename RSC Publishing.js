{
	"translatorID": "ca0e7488-ef20-4485-8499-9c47e60dcfa7",
	"label": "RSC Publishing",
	"creator": "Sebastian Karcher",
	"target": "^https?://(:?www\\.|google\\.)?pubs\\.rsc\\.org/",
	"minVersion": "2.1.9",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsb",
	"lastUpdated": "2026-09-06 00:00:00"
}

/*
	***** BEGIN LICENSE BLOCK *****

	RSC Publishing Translator
	Copyright © 2011 Aurimas Vinckevicius

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

/** Both search result and book ToC pages use javascript to load content, so
 * this actually doesn't work as intended. Search results will work, but
 * will also trigger on empty result set. detectWeb for book ToC does not
 * work, but doWeb does,
 */
function getResults(doc) {
	return ZU.xpath(doc, '//div[@id="all" or @id="chapterList"]//div[contains(@class,"title_text")]//a[not(contains(@href,"/database/"))]');
}

function detectWeb(doc, url) {
	if (/\/results[?/]/i.test(url) || url.includes('/ebook/')
		&& getResults(doc).length) {
		return 'multiple';
	}
	// apparently URLs sometimes have upper case as in /Content/ArticleLanding/
	if ((/\/content\/articlelanding\//i.test(url)
		|| /\/[a-z]{2}\/article\/doi\/10\.1039\//i.test(url)
		// Current RSC pages redirect to canonical issue routes such as
		// /sc/article/15/11/3879/827846/Title and legacy routes such as
		// /ee/article-abstract/5/1/5221/349075/Title.
		|| /\/[a-z]{2}\/article(?:-abstract)?\/(?:doi\/10\.1039\/|(?:\d+\/){4})/i.test(url))
		&& ZU.xpathText(doc, '//meta[@name="citation_title"]/@content')) {
		return 'journalArticle';
	}

	if (url.search(/\/content\/chapter\//i) != -1) {
		return 'bookSection';
	}

	return false;
}

var suppTypeMap = {
	pdf: 'application/pdf',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	csv: 'text/csv',
	txt: 'text/plain',
	zip: 'application/zip',
	mp4: 'video/mp4'
};

function getSupplementaryMimeType(link, title) {
	// Current RSC files use routes such as
	// /ma/article-supplement/1287895/mp4/d6ma00514d1_suppl/ without a
	// filename extension, so prefer their explicit format path component.
	var type = link.href.match(/\/article-supplement\/[^/]+\/([a-z0-9]+)\//i);
	if (type) type = suppTypeMap[type[1].toLowerCase()];
	if (type) return type;

	var fileName = link.getAttribute('download')
		|| link.href.replace(/[?#].*$/, '');
	var extension = fileName && fileName.match(/\.([a-z0-9]+)$/i);
	if (extension) {
		type = suppTypeMap[extension[1].toLowerCase()];
		if (type) return type;
	}

	var textType = title.match(/\b(pdf|docx?|xlsx?|csv|txt|zip|mp4)\b/i);
	return textType && suppTypeMap[textType[1].toLowerCase()];
}

function getSupplementaryAttachments(doc, attachAsLink) {
	var attachments = [];
	var seen = {};
	var pageURL = doc.location && (doc.location.href || String(doc.location));
	var page;
	var articleID;
	try {
		page = pageURL && new URL(pageURL);
		// The current and legacy canonical routes both expose the numeric RSC
		// article ID immediately after volume/issue/page.
		articleID = pageURL && pageURL.match(/\/article(?:-abstract)?\/(?:\d+\/){3}(\d+)(?:\/|$)/i);
		articleID = articleID && articleID[1];
	}
	catch (e) {
		page = null;
	}
	var links = doc.querySelectorAll([
		'.widget-ArticleDataSupplements a[href*="/article-supplement/"]',
		'a.js-download-file-gtm-datalayer-event[href*="/article-supplement/"]',
		'.list__item-link[href]'
	].join(', '));

	for (var i = 0; i < links.length; i++) {
		var link = links[i];
		var parsedURL;
		try {
			parsedURL = new URL(link.href, pageURL);
		}
		catch (e) {
			continue;
		}
		if (!/^https?:$/.test(parsedURL.protocol)
			|| parsedURL.username || parsedURL.password || parsedURL.port
			|| page && parsedURL.host.toLowerCase() != page.host.toLowerCase()) {
			continue;
		}
		var supplementID = parsedURL.pathname.match(/\/article-supplement\/([^/]+)/i);
		if (articleID && supplementID && articleID != supplementID[1]) continue;
		var attachmentURL = parsedURL.href.replace(/#.*$/, '');
		if (!attachmentURL || seen[attachmentURL]) continue;

		var container = link.closest && link.closest('.dataSuppLink');
		var title = ZU.trimInternal((container || link).textContent);
		// The legacy list selector is broad enough to include non-SI links.
		if (!/\/article-supplement\//i.test(attachmentURL)
			&& !/(?:supplementary|supporting|electronic supplementary|\bESI\b)/i.test(title)) {
			continue;
		}
		seen[attachmentURL] = true;

		var mimeType = getSupplementaryMimeType(link, title);
		var attachment = {
			title: title || 'Supplementary file',
			url: attachmentURL,
			snapshot: !!(!attachAsLink && mimeType)
		};
		if (mimeType) attachment.mimeType = mimeType;
		attachments.push(attachment);
	}

	return attachments;
}

function scrape(doc, url, type) {
	var translator = Zotero.loadTranslator('web');
	translator.setTranslator('951c027d-74ac-47d4-a107-9c3069ab7b48');
	translator.setDocument(doc);
	translator.setHandler('itemDone', function (obj, item) {
	//	item.itemType = type;


		// keywords is frequently an empty string
		if (item.tags.length == 1 && !item.tags[0]) {
			item.tags = [];
		}

		if (item.date) {
			item.date = ZU.strToISO(item.date);
		}

		// Preserve Embedded Metadata's main-PDF attachment. Supplementary files
		// are additive and obey the shared Connector/Desktop preferences.
		if (Z.getHiddenPref && Z.getHiddenPref('attachSupplementary')) {
			try {
				var attachments = getSupplementaryAttachments(
					doc, Z.getHiddenPref('supplementaryAsLink'));
				item.attachments = item.attachments.concat(attachments);
			}
			catch (e) {
				// Supplementary files are optional; preserve metadata and the main PDF
				// when the page's optional SI section cannot be inspected.
				Z.debug('RSC Publishing: Error attaching supplementary information.');
			}
		}

		item.complete();
	});
	translator.getTranslatorObject(function (trans) {
		trans.itemType = type;
		trans.doWeb(doc, url);
	});
}

function doWeb(doc, url) {
	var type = detectWeb(doc, url);
	if (type == 'multiple') {
		var results = getResults(doc);
		var items = {};
		for (var i = 0, n = results.length; i < n; i++) {
			items[results[i].href] = ZU.trimInternal(
				ZU.xpathText(results[i], './node()', null, ' '));
		}

		Zotero.selectItems(items, function (selectedItems) {
			if (!selectedItems) return;

			var urls = [];
			for (var i in selectedItems) {
				urls.push(i);
			}
			ZU.processDocuments(urls, doWeb);
		});
	}
	else {
		scrape(doc, url, type);
	}
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://pubs.rsc.org/en/content/articlelanding/2012/ee/c1ee02148f#!divAbstract",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Superior radical polymer cathode material with a two-electron process redox reaction promoted by graphene",
				"creators": [
					{
						"firstName": "Wei",
						"lastName": "Guo",
						"creatorType": "author"
					},
					{
						"firstName": "Ya-Xia",
						"lastName": "Yin",
						"creatorType": "author"
					},
					{
						"firstName": "Sen",
						"lastName": "Xin",
						"creatorType": "author"
					},
					{
						"firstName": "Yu-Guo",
						"lastName": "Guo",
						"creatorType": "author"
					},
					{
						"firstName": "Li-Jun",
						"lastName": "Wan",
						"creatorType": "author"
					}
				],
				"date": "2012-01-01",
				"DOI": "10.1039/C1EE02148F",
				"ISSN": "1754-5706",
				"abstractNote": "Poly(2,2,6,6-tetramethyl-1-piperidinyloxy-4-yl methacrylate) (PTMA) displays a two–electron process redox reaction, high capacity of up to 222 mA h g−1, good rate performance and long cycle life, which is promoted by graphene as cathode material for lithium rechargeable batteries.",
				"issue": "1",
				"journalAbbreviation": "Energy Environ. Sci.",
				"language": "en",
				"libraryCatalog": "pubs.rsc.org",
				"pages": "5221-5225",
				"publicationTitle": "Energy & Environmental Science",
				"url": "https://pubs.rsc.org/en/content/articlelanding/2012/ee/c1ee02148f",
				"volume": "5",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					},
					{
						"title": "Snapshot",
						"mimeType": "text/html"
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
		"url": "https://pubs.rsc.org/en/content/chapter/bk9781849730518-00330/978-1-84973-051-8#!divabstract",
		"items": [
			{
				"itemType": "bookSection",
				"title": "Chapter 14:In Vivo Approaches to Predictive Toxicology Using Zebrafish",
				"creators": [
					{
						"firstName": "Michael T.",
						"lastName": "Simonich",
						"creatorType": "author"
					},
					{
						"firstName": "Jill A.",
						"lastName": "Franzosa",
						"creatorType": "author"
					},
					{
						"firstName": "Robert L.",
						"lastName": "Tanguay*",
						"creatorType": "author"
					}
				],
				"date": "2011-11-15",
				"abstractNote": "A key to sustainability in modern paradigms of drug discovery and toxicology will be predictive structure–activity relationships based on vertebrate-model responses. The zebrafish embryo is the emerging vertebrate choice for rapid-throughput chemical screening, providing a quick and inexpensive way to test hypotheses and to generate strategies for complementary integrative research with rodent models, and humans. Numerous embryonic zebrafish assays and omics approaches appear to predict hazard in mammals. We review physiologic parameters of the zebrafish that are amenable to rapid-throughput screening. Toxicity investigations in the zebrafish have included endpoints in developmental, neuro, cardio, ocular, otic, gastrointestinal, hepato, regenerative and vascular toxicity. Small-scale screens have used zebrafish embryos to analyze heart rate and ERG function, and to screen drugs that affect these parameters. Novel tissue-specific and xenobiotic-responsive reporter lines are enabling rapid screening of new chemistries for cardio, hepato, and neuronal toxicity. In particular, zebrafish screens that combine gene expression profiling with comprehensive phenotype analyses are strengthening the predictivity of the toxicology data and fostering greater use of the model, especially as a means of frontloading hazard detection and reducing late-stage attrition in drug discovery. A pressing need remains for large-scale zebrafish studies that systematically evaluate the most promising zebrafish assays against the widest possible range of positive and negative reference compounds to distinguish the truly predictive approaches in zebrafish from those that are not.",
				"bookTitle": "New Horizons in Predictive Toxicology",
				"extra": "DOI: 10.1039/9781849733045-00330",
				"language": "en",
				"libraryCatalog": "pubs.rsc.org",
				"pages": "330-355",
				"shortTitle": "Chapter 14",
				"url": "https://pubs.rsc.org/en/content/chapter/bk9781849730518-00330/978-1-84973-051-8",
				"attachments": [
					{
						"title": "Full Text PDF",
						"mimeType": "application/pdf"
					},
					{
						"title": "Snapshot",
						"mimeType": "text/html"
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
		"url": "http://pubs.rsc.org/en/results?searchtext=open%20source",
		"defer": true,
		"items": "multiple"
	}
]
/** END TEST CASES **/
