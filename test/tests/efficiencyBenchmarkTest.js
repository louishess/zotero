const runEfficiencyBenchmarks = Services.env.get('ZOTEROMERGE_BENCHMARKS') === '1'
	? describe : describe.skip;

runEfficiencyBenchmarks('ZoteroMerge efficiency measurements', function () {
	this.timeout(900000);
	const results = { runtime: Services.appinfo.platformVersion, measurements: [] };
	const output = Services.env.get('ZOTEROMERGE_BENCHMARK_OUTPUT');
	let directory;
	let fixtures;
	let sandbox;

	async function record(label, operation) {
		let ticks = [];
		let last = performance.now();
		let timer = setInterval(() => {
			let now = performance.now();
			ticks.push(Math.max(0, now - last - 10));
			last = now;
		}, 10);
		let memory = Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
		let residentBefore = memory.resident;
		let transactions = [];
		let queryCount = 0;
		let stats = 0;
		let copies = 0;
		let probes = sinon.createSandbox();
		let execute = Zotero.DB.executeTransaction.bind(Zotero.DB);
		let query = Zotero.DB.queryAsync.bind(Zotero.DB);
		let stat = IOUtils.stat.bind(IOUtils);
		let copy = IOUtils.copy.bind(IOUtils);
		probes.stub(Zotero.DB, 'executeTransaction').callsFake(async (...args) => {
			let nested = Zotero.DB.transactionInProgress();
			let start = performance.now();
			try { return await execute(...args); }
			finally { if (!nested) transactions.push(performance.now() - start); }
		});
		probes.stub(Zotero.DB, 'queryAsync').callsFake((...args) => { queryCount++; return query(...args); });
		probes.stub(IOUtils, 'stat').callsFake((...args) => { stats++; return stat(...args); });
		probes.stub(IOUtils, 'copy').callsFake((...args) => { copies++; return copy(...args); });
		let start = performance.now();
		try {
			await operation();
			let elapsedMs = performance.now() - start;
			await Zotero.Promise.delay(30);
			ticks.sort((a, b) => a - b);
			results.measurements.push({ label, elapsedMs, queryCount, stats, copies,
				transactionCount: transactions.length,
				maxTransactionMs: Math.max(0, ...transactions),
				totalTransactionMs: transactions.reduce((sum, value) => sum + value, 0),
				maxTimerDelayMs: Math.max(0, ...ticks),
				p95TimerDelayMs: ticks[Math.floor(ticks.length * 0.95)] || 0,
				residentBefore, residentAfter: memory.resident });
			dump('EFFICIENCY ' + JSON.stringify(results.measurements.at(-1)) + '\n');
		}
		finally {
			clearInterval(timer);
			probes.restore();
		}
	}

	before(async function () {
		assert.isTrue(Zotero.automatedTest, 'Benchmarks require the disposable test harness');
		assert.isTrue(PathUtils.isAbsolute(output), 'An absolute output path is required');
		directory = await getTempDirectory();
		fixtures = PathUtils.join(directory, 'fixtures');
		await IOUtils.makeDirectory(fixtures);
		sandbox = sinon.createSandbox();
		await Zotero.Reader._stopAnnotationFilePolling();
		Zotero.Prefs.set('linkedFolderAttachments.enabled', false);
		Zotero.Prefs.set('linkedFolderAttachments.provider', 'local-folder');
		Zotero.Prefs.set('reader.annotations.storageMode', 'standard');
		Zotero.Prefs.set('saveRelativeAttachmentPath', true);
	});

	after(async function () {
		sandbox?.restore();
		await Zotero.Reader._stopAnnotationFilePolling();
		await Zotero.LinkedFolderAttachmentManager.pause();
		if (output) await IOUtils.writeJSON(output, results);
		if (directory) await IOUtils.remove(directory, { recursive: true });
	});

	it('measures native whole-file hashing and real attachment migration', async function () {
		let block = new Uint8Array(1024 * 1024);
		for (let i = 0; i < block.length; i++) block[i] = i % 251;
		for (let mebibytes of [10, 100, 1024]) {
			let file = PathUtils.join(fixtures, `supporting-${mebibytes}.bin`);
			for (let i = 0; i < mebibytes; i++) {
				await IOUtils.write(file, block, { mode: i ? 'append' : 'overwrite' });
			}
			for (let repeat = 0; repeat < 3; repeat++) {
				await record(`sha256-${mebibytes}MiB-${repeat}`, async () => {
					assert.match(await Zotero.LinkedFolderAttachmentManager.sha256File(file), /^[a-f0-9]{64}$/);
				});
			}
			let root = PathUtils.join(directory, `managed-${mebibytes}`);
			await IOUtils.makeDirectory(root);
			Zotero.Prefs.set('baseAttachmentPath', root);
			await Zotero.DB.queryAsync("DELETE FROM settings WHERE setting='linkedFolderAttachmentManager'");
			let parent = await createDataObject('item', { itemType: 'journalArticle', title: `Benchmark ${mebibytes}` });
			let attachment = await Zotero.Attachments.importFromFile({
				file: Zotero.File.pathToFile(file), parentItemID: parent.id,
				title: 'Supporting information', contentType: 'application/octet-stream'
			});
			await Zotero.LinkedFolderAttachmentManager.resume();
			let getPref = Zotero.Prefs.get.bind(Zotero.Prefs);
			sandbox.stub(Zotero.Prefs, 'get').callsFake((name, ...args) =>
				name === 'linkedFolderAttachments.enabled' ? true : getPref(name, ...args));
			try {
				await Zotero.LinkedFolderAttachmentManager.claimOrganizer();
				await record(`migration-${mebibytes}MiB`, async () => {
					let linked = await Zotero.LinkedFolderAttachmentManager.convertStoredFileToLinkedFile(attachment.id);
					assert.isTrue(linked?.isLinkedFileAttachment?.(), JSON.stringify(await Zotero.LinkedFolderAttachmentManager.getMigrationStatus()));
					assert.equal((await IOUtils.stat(await linked.getFilePathAsync())).size, mebibytes * block.length);
				});
			}
			finally { sandbox.restore(); }
			await Zotero.LinkedFolderAttachmentManager.pause();
		}
	});

	it('measures polling actual linked PDF libraries in Standard and unchanged Dual modes', async function () {
		let root = PathUtils.join(directory, 'polling');
		await IOUtils.makeDirectory(root);
		Zotero.Prefs.set('baseAttachmentPath', root);
		let parent = await createDataObject('item', { itemType: 'journalArticle', title: 'Polling benchmark' });
		let items = [];
		for (let count of [100, 1000, 10000]) {
			await Zotero.DB.executeTransaction(async () => {
				while (items.length < count) {
					let name = `poll-${items.length}.pdf`;
					await IOUtils.copy(PathUtils.join(getTestDataDirectory().path, 'test.pdf'), PathUtils.join(root, name));
					items.push(await Zotero.Attachments.linkFromFileWithRelativePath({
						path: name, title: name, contentType: 'application/pdf', parentItemID: parent.id,
						saveOptions: { skipNotifier: true }
					}));
				}
			});
			Zotero.Reader._annotationFilePollStopping = false;
			for (let mode of ['standard', 'pdf-and-zotero']) {
				Zotero.Prefs.set('reader.annotations.storageMode', mode);
				Zotero.Reader._annotationFilePollState.clear();
				for (let item of items) {
					let token = await Zotero.Reader._getAnnotationFilePollToken(PathUtils.join(root, item.getField('title')));
					Zotero.Reader._annotationFilePollState.set(item.id, { ...token, mode, status: 'reconciled' });
				}
				for (let repeat = 0; repeat < 3; repeat++) {
					await record(`poll-${count}-${mode}-${repeat}`, () => Zotero.Reader._pollLinkedPDFAnnotations());
				}
			}
		}
	});
});
