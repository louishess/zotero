#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

(async () => {
	const app = path.resolve(process.argv[2] || '');
	assert(process.argv[2] && app !== '/Applications/Zotero.app', 'Provide the non-installed package');
	const executable = path.join(app, 'Contents/MacOS/zotero');
	assert(fs.existsSync(executable));
	const server = net.createServer();
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const port = server.address().port;
	await new Promise(resolve => server.close(resolve));
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zoteromerge-package-smoke-'));
	const profile = path.join(temporary, 'profile');
	const data = path.join(temporary, 'library');
	fs.mkdirSync(profile);
	fs.mkdirSync(data);
	const prefs = {
		'app.update.enabled': false,
		'extensions.zotero.useDataDir': true,
		'extensions.zotero.dataDir': data,
		'extensions.zotero.firstRun.skipFirefoxProfileAccessCheck': true,
		'extensions.zotero.firstRunGuidance': false,
		'extensions.zotero.firstRun2': false,
		'extensions.zotero.sync.autoSync': false,
		'extensions.zotero.automaticScraperUpdates': false,
		'extensions.zotero.httpServer.enabled': true,
		'extensions.zotero.httpServer.localAPI.enabled': true,
		'extensions.zotero.httpServer.port': port,
		'extensions.zoteroMacWordIntegration.skipInstallation': true,
		'extensions.zoteroOpenOfficeIntegration.skipInstallation': true
	};
	fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs)
		.map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
	const child = spawn(executable, ['-no-remote', '-profile', profile], {
		env: { ...process.env, MOZ_NO_REMOTE: '1', NO_EM_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe']
	});
	const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	try {
		let response;
		for (let attempt = 0; attempt < 90; attempt++) {
			if (child.exitCode !== null || child.signalCode !== null) {
				throw new Error(`Package exited before startup: ${child.exitCode ?? child.signalCode}`);
			}
			try {
				response = await fetch(`http://127.0.0.1:${port}/api/users/0/items`, {
					headers: { 'Zotero-API-Version': '3' }, signal: AbortSignal.timeout(1000)
				});
				if (response.ok) break;
			}
			catch (_) { /* Startup has not opened the disposable API yet. */ }
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		assert(response?.ok, 'Packaged application did not start its disposable local API');
		const items = await response.json();
		assert(Array.isArray(items));
		assert(fs.existsSync(path.join(data, 'zotero.sqlite')), 'Package must use the disposable library');
		console.log(JSON.stringify({ package: app, profile, data, port, startup: 'passed', itemCount: items.length,
			personalProfileUsed: false, installed: false }));
	}
	finally {
		child.kill('SIGTERM');
		const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
		await closed;
		clearTimeout(timer);
		fs.rmSync(temporary, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
