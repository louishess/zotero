#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const puppeteer = require('../connector/node_modules/puppeteer');

(async () => {
	assert(process.argv[2], 'Provide an unpacked production Connector directory');
	const extension = path.resolve(process.argv[2]);
	const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
	assert.equal(manifest.manifest_version, 3);
	const browser = await puppeteer.launch({ headless: true, args: [
		`--disable-extensions-except=${extension}`, `--load-extension=${extension}`
	] });
	try {
		const target = await browser.waitForTarget(target => target.type() === 'service_worker'
			&& target.url().endsWith('background-worker.js'), { timeout: 15000 });
		const worker = await target.worker();
		const result = await worker.evaluate(async () => {
			await Zotero.initDeferred.promise;
			const endpoint = Zotero.Prefs.get('connector.url');
			const connector = Zotero.Connector;
			const original = connector.automaticAttachmentDownloads;
			try {
				connector._processAutomaticAttachmentDownloads({ version: 1,
					types: [{ key: 'pdf', extension: 'pdf', mimeTypes: ['application/pdf'] }],
					genericMIMETypes: ['application/octet-stream'], enabled: { pdf: false } });
				return { endpoint, hasPolicy: !!connector.getAutomaticAttachmentDownloads(),
					automaticPDF: connector.shouldDownloadAttachment({ mimeType: 'application/pdf', url: 'https://example.invalid/a.pdf' }),
					explicitPDF: connector.shouldDownloadAttachment({ mimeType: 'application/pdf', url: 'https://example.invalid/a.pdf' }, { automatic: false }),
					translatorPolicyMethod: typeof connector._processTranslatorPreferences };
			}
			finally { connector.automaticAttachmentDownloads = original; }
		});
		assert.equal(result.endpoint, 'http://127.0.0.1:23119/');
		assert.equal(result.hasPolicy, true);
		assert.equal(result.automaticPDF, false);
		assert.equal(result.explicitPDF, true);
		assert.equal(result.translatorPolicyMethod, 'function');
		console.log(JSON.stringify({ extension, name: manifest.name, version: manifest.version,
			...result, disposableBrowserProfile: true, installed: false }));
	}
	finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
