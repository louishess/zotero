{
	"translatorID": "86eeed04-0b96-43ea-a5e2-544f15469ce4",
	"label": "Beilstein Journal of Organic Chemistry",
	"creator": "OpenAI",
	"target": "^https?://(?:www\\.)?beilstein-journals\\.org/bjoc/articles/\\d+/\\d+/?(?:[?#].*)?$",
	"minVersion": "5.0",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 4,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-09-05 00:00:00"
}

/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2026 Zotero contributors

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

	The article metadata and primary PDF come from Embedded Metadata. The
	publisher's article page exposes article-scoped supplementary downloads in
	the #supporting-info table.
*/

var EMBEDDED_METADATA_TRANSLATOR = "951c027d-74ac-47d4-a107-9c3069ab7b48";

var BEILSTEIN_SUPPLEMENTARY_MIME_TYPES = {
	pdf: "application/pdf",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	txt: "text/plain",
	md: "text/markdown",
	zip: "application/zip",
	tar: "application/x-tar",
	gz: "application/gzip",
	bz2: "application/x-bzip2",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	webm: "video/webm"
};

function detectWeb(doc, url) {
	try {
		var articleURL = new URL(url);
		if ((articleURL.protocol !== "http:" && articleURL.protocol !== "https:")
			|| articleURL.username || articleURL.password || articleURL.port
			|| !/^(?:www\.)?beilstein-journals\.org$/i.test(articleURL.hostname)
			|| !/^\/bjoc\/articles\/\d+\/\d+\/?$/i.test(articleURL.pathname)) {
			return false;
		}
	}
	catch (e) {
		return false;
	}
	var journal = getMetaContent(doc, "citation_journal_title");
	return journal && /Beilstein Journal of Organic Chemistry/i.test(journal)
		? "journalArticle"
		: false;
}

function getMetaContent(doc, name) {
	var meta = doc.querySelector('meta[name="' + name + '"]');
	return meta && meta.getAttribute("content");
}

function trimText(value) {
	return value ? ZU.trimInternal(value) : "";
}

function getNearestAncestor(node, nodeName) {
	for (var i = 0; node && i < 8; i++, node = node.parentNode) {
		if (node.nodeName && node.nodeName.toUpperCase() === nodeName) return node;
	}
	return null;
}

function getFormat(row) {
	var text = trimText(row && row.textContent);
	var match = text.match(/\bFormat:\s*([a-z0-9][a-z0-9+.-]*)\b/i);
	return match ? match[1].toLowerCase() : null;
}

function getURL(link, doc, articleID) {
	var href = link && link.getAttribute("href");
	if (!href) return null;
	try {
		var url = new URL(href, doc.location.href);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.username || url.password) return null;
		var host = url.hostname.toLowerCase();
		if (host !== "beilstein-journals.org" && host !== "www.beilstein-journals.org") return null;
		if (url.port) return null;
		if (!/^\/bjoc\/content\/supplementary\//i.test(url.pathname)) return null;
		if (!articleID || !/^\d+(?:-\d+)*$/.test(articleID)) return null;
		var prefix = "/bjoc/content/supplementary/" + articleID + "-S";
		if (url.pathname.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) return null;
		if (!/^\d+\.[a-z0-9]{1,12}$/i.test(url.pathname.slice(prefix.length))) {
			return null;
		}
		url.hash = "";
		return url;
	}
	catch (e) {
		return null;
	}
}

function getFileTitle(link, row, index) {
	var tableBody = row && row.parentNode;
	var rows = tableBody && tableBody.children;
	var rowIndex = rows ? Array.prototype.indexOf.call(rows, row) : -1;
	if (rows && rowIndex >= 0) {
		for (var i = rowIndex - 1; i >= 0 && i >= rowIndex - 3; i--) {
			var previousText = trimText(rows[i].textContent);
			if (/Supporting Information File\s+\d+/i.test(previousText)) return previousText;
		}
	}
	var linkText = trimText(link && link.textContent);
	return linkText || "Supplementary Material " + (index + 1);
}

function attachBeilsteinSupplementary(doc, item) {
	var section = doc.querySelector("#supporting-info");
	if (!section) return;
	var links = section.querySelectorAll('a[download][href]');
	var articleID = getMetaContent(doc, "citation_id");
	var seen = {};
	var attachAsLink = Z.getHiddenPref("supplementaryAsLink");
	for (var i = 0; i < links.length; i++) {
		var link = links[i];
		var row = getNearestAncestor(link, "TR");
		var url = getURL(link, doc, articleID);
		if (!url || seen[url.href]) continue;
		seen[url.href] = true;

		var format = getFormat(row);
		var extension = format && BEILSTEIN_SUPPLEMENTARY_MIME_TYPES[format] ? format : null;
		if (!extension) {
			var pathMatch = url.pathname.match(/\.([a-z0-9]{1,12})$/i);
			var pathExtension = pathMatch && pathMatch[1].toLowerCase();
			if (pathExtension && BEILSTEIN_SUPPLEMENTARY_MIME_TYPES[pathExtension]) extension = pathExtension;
		}
		var mimeType = extension && BEILSTEIN_SUPPLEMENTARY_MIME_TYPES[extension];
		var attachment = {
			title: getFileTitle(link, row, i),
			url: url.href,
			snapshot: !attachAsLink && Boolean(mimeType)
		};
		if (mimeType) attachment.mimeType = mimeType;
		item.attachments.push(attachment);
	}
}

function scrape(doc) {
	var translator = Zotero.loadTranslator("web");
	translator.setTranslator(EMBEDDED_METADATA_TRANSLATOR);
	translator.setDocument(doc);
	translator.setHandler("itemDone", function (_obj, item) {
		if (Z.getHiddenPref && Z.getHiddenPref("attachSupplementary")) {
			try {
				attachBeilsteinSupplementary(doc, item);
			}
			catch (e) {
				Z.debug("Beilstein: Error attaching supplementary information.");
				Z.debug(e);
			}
		}
		item.complete();
	});
	translator.translate();
}

function doWeb(doc, url) {
	if (detectWeb(doc, url) === "journalArticle") scrape(doc);
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "https://www.beilstein-journals.org/bjoc/articles/20/95",
		"items": [
			{
				"itemType": "journalArticle",
				"title": "Light on the sustainable preparation of aryl-cored dibromides",
				"creators": [
					{ "firstName": "Fabrizio", "lastName": "Roncaglia", "creatorType": "author" },
					{ "firstName": "Alberto", "lastName": "Ughetti", "creatorType": "author" },
					{ "firstName": "Nicola", "lastName": "Porcelli", "creatorType": "author" },
					{ "firstName": "Biagio", "lastName": "Anderlini", "creatorType": "author" },
					{ "firstName": "Andrea", "lastName": "Severini", "creatorType": "author" },
					{ "firstName": "Luca", "lastName": "Rigamonti", "creatorType": "author" }
				],
				"date": "2024-05-14",
				"DOI": "10.3762/bjoc.20.95",
				"ISSN": "1860-5397",
				"issue": "1",
				"journalAbbreviation": "Beilstein J. Org. Chem.",
				"language": "en",
				"pages": "1076-1087",
				"publicationTitle": "Beilstein Journal of Organic Chemistry",
				"url": "https://www.beilstein-journals.org/bjoc/articles/20/95",
				"volume": "20",
				"attachments": [
					{ "title": "Full Text PDF", "mimeType": "application/pdf" }
				],
				"tags": [
					{ "tag": "aryl halides" },
					{ "tag": "benzyl halides" },
					{ "tag": "bromination" },
					{ "tag": "sustainability" }
				],
				"notes": [],
				"seeAlso": []
			}
		]
	}
]
/** END TEST CASES **/
