"use strict";

describe("Zotero.AutomaticAttachmentDownloads", function () {
	const PREF_PREFIX = "automaticAttachmentDownloads.";
	const TYPES = ["pdf", "docx", "md", "xlsx", "mp3", "mp4", "webm"];
	const MIME_TYPES = {
		pdf: [
			"application/pdf",
			"application/x-pdf",
			"application/acrobat",
			"applications/vnd.pdf",
			"text/pdf",
			"text/x-pdf",
		],
		docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
		md: ["text/markdown", "text/x-markdown"],
		xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
		mp3: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
		mp4: ["video/mp4", "audio/mp4", "application/mp4"],
		webm: ["video/webm", "audio/webm"],
	};

	beforeEach(function () {
		for (let type of TYPES) {
			Zotero.Prefs.clear(PREF_PREFIX + type);
		}
	});

	it("should enable all controlled types by default", function () {
		for (let type of TYPES) {
			assert.isTrue(Zotero.AutomaticAttachmentDownloads.isTypeEnabled(type), type);
		}
	});

	it("should classify controlled MIME types and extensions", function () {
		for (let type of TYPES) {
			for (let mimeType of MIME_TYPES[type]) {
				assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
					contentType: mimeType,
				}), type, mimeType);
			}
			assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
				filename: `attachment.${type.toUpperCase()}`,
			}), type, type);
		}
		assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
			contentType: "Application/PDF; charset=binary",
		}), "pdf");
		assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
			contentType: "application/octet-stream",
			filename: "notes.md",
		}), "md");
		assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
			contentType: "binary/octet-stream",
			url: "https://example.com/data.xlsx?x=1#y",
		}), "xlsx");
		assert.equal(Zotero.AutomaticAttachmentDownloads.classify({
			url: "https://example.com/audio.MP3?download=1",
		}), "mp3");
	});

	it("should prefer specific MIME types and allow unknown types", function () {
		assert.isNull(Zotero.AutomaticAttachmentDownloads.classify({
			contentType: "text/plain",
			filename: "misleading.pdf",
		}));
		assert.isNull(Zotero.AutomaticAttachmentDownloads.classify({
			filename: "archive.zip",
		}));
		assert.isNull(Zotero.AutomaticAttachmentDownloads.classify({
			filename: "paper.pdf.exe",
		}));
		assert.isTrue(Zotero.AutomaticAttachmentDownloads.shouldDownload({
			contentType: "text/plain",
			filename: "paper.pdf",
		}));
	});

	it("should block only automatic, non-forced downloads of every disabled type", function () {
		for (let type of TYPES) {
			Zotero.Prefs.set(PREF_PREFIX + type, false);
			let metadata = { contentType: MIME_TYPES[type][0], filename: `attachment.${type}` };
			assert.isFalse(Zotero.AutomaticAttachmentDownloads.shouldDownload(metadata), type);
			assert.isTrue(Zotero.AutomaticAttachmentDownloads.shouldDownload({
				...metadata,
				automatic: false,
			}), type);
			assert.isTrue(Zotero.AutomaticAttachmentDownloads.shouldDownload({
				...metadata,
				force: true,
			}), type);
			Zotero.Prefs.clear(PREF_PREFIX + type);
		}
		assert.isTrue(Zotero.AutomaticAttachmentDownloads.shouldDownload({
			contentType: "application/zip",
			filename: "archive.zip",
		}));
	});

	it("should allow explicit ItemSaver downloads for disabled types", function () {
		let hadDownloadAssociatedFiles = Zotero.Prefs.prefHasUserValue("downloadAssociatedFiles");
		let oldDownloadAssociatedFiles = Zotero.Prefs.get("downloadAssociatedFiles");
		Zotero.Prefs.set("downloadAssociatedFiles", true);
		Zotero.Prefs.set(PREF_PREFIX + "pdf", false);
		try {
			let automaticSaver = new Zotero.Translate.ItemSaver({
				libraryID: Zotero.Libraries.userLibraryID,
				attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD,
			});
			assert.isFalse(automaticSaver._canSaveAttachment({
				mimeType: "application/pdf",
				url: "https://example.com/paper.pdf",
			}));

			let explicitSaver = new Zotero.Translate.ItemSaver({
				libraryID: Zotero.Libraries.userLibraryID,
				attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD,
				automatic: false,
			});
			assert.isTrue(explicitSaver._canSaveAttachment({
				mimeType: "application/pdf",
				url: "https://example.com/paper.pdf",
			}));

			let forcedSaver = new Zotero.Translate.ItemSaver({
				libraryID: Zotero.Libraries.userLibraryID,
				attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD,
				force: true,
			});
			assert.isTrue(forcedSaver._canSaveAttachment({
				mimeType: "application/pdf",
				url: "https://example.com/paper.pdf",
			}));
		}
		finally {
			if (hadDownloadAssociatedFiles) {
				Zotero.Prefs.set("downloadAssociatedFiles", oldDownloadAssociatedFiles);
			}
			else {
				Zotero.Prefs.clear("downloadAssociatedFiles");
			}
		}
	});

	it("should filter translator files without filtering links or local imports", function () {
		Zotero.Prefs.set(PREF_PREFIX + "pdf", false);
		let saver = new Zotero.Translate.ItemSaver({
			libraryID: Zotero.Libraries.userLibraryID,
			attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD,
		});
		assert.isFalse(saver._canSaveAttachment({
			mimeType: "application/pdf",
			url: "https://example.com/paper.pdf",
		}));
		assert.isTrue(saver._canSaveAttachment({
			mimeType: "application/pdf",
			url: "https://example.com/paper.pdf",
			snapshot: false,
		}));

		let fileSaver = new Zotero.Translate.ItemSaver({
			libraryID: Zotero.Libraries.userLibraryID,
			attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_FILE,
		});
		assert.isTrue(fileSaver._canSaveAttachment({
			mimeType: "application/pdf",
			path: getTestDataDirectory().path + "/test.pdf",
		}));
	});

	it("should not try an automatic OA PDF fallback when PDFs are disabled", async function () {
		Zotero.Prefs.set(PREF_PREFIX + "pdf", false);
		let saver = new Zotero.Translate.ItemSaver({
			libraryID: Zotero.Libraries.userLibraryID,
			attachmentMode: Zotero.Translate.ItemSaver.ATTACHMENT_MODE_DOWNLOAD,
		});
		let oaStub = sinon.stub(saver, "_getOpenAccessPDFURLs").resolves([]);
		await saver.saveItems([{
			itemType: "journalArticle",
			title: "No automatic PDF",
			DOI: "10.1234/example",
		}], () => {});
		assert.isFalse(oaStub.called);
	});

	it("should filter ordinary storage downloads but preserve forced downloads", async function () {
		let item = await importFileAttachment("test.pdf");
		try {
			Zotero.Prefs.set(PREF_PREFIX + "pdf", false);
			item.attachmentSyncState = "force_download";
			await item.saveTx({ skipAll: true });
			let itemIDs = await Zotero.Sync.Storage.Local.getFilesToDownload(item.libraryID, false);
			assert.include(itemIDs, item.id);

			item.attachmentSyncState = "to_download";
			await item.saveTx({ skipAll: true });

			itemIDs = await Zotero.Sync.Storage.Local.getFilesToDownload(
				item.libraryID,
				false
			);
			assert.notInclude(itemIDs, item.id);
			assert.equal(item.attachmentSyncState,
				Zotero.Sync.Storage.Local.SYNC_STATE_TO_DOWNLOAD);

			item.attachmentSyncState = "to_upload";
			await item.saveTx({ skipAll: true });
			let uploadIDs = await Zotero.Sync.Storage.Local.getFilesToUpload(item.libraryID);
			assert.include(uploadIDs, item.id);

			item.attachmentSyncState = "force_download";
			await item.saveTx({ skipAll: true });
			itemIDs = await Zotero.Sync.Storage.Local.getFilesToDownload(item.libraryID, true);
			assert.include(itemIDs, item.id);
		}
		finally {
			await item.eraseTx();
		}
	});

	it("should revisit pending storage downloads when a type is re-enabled", async function () {
		let invalidateStub = sinon.stub(
			Zotero.AutomaticAttachmentDownloads,
			"invalidatePendingStorageDownloads"
		).resolves();
		try {
			Zotero.Prefs.set(PREF_PREFIX + "pdf", false);
			assert.isFalse(invalidateStub.called);
			Zotero.Prefs.set(PREF_PREFIX + "pdf", true);
			await waitForCallback(() => invalidateStub.calledOnce, 20, 10);
		}
		finally {
			invalidateStub.restore();
		}
	});

	it("should expose accessible, preference-backed controls in Sync preferences", async function () {
		let win = await loadWindow("chrome://zotero/content/preferences/preferences.xhtml", {
			pane: "zotero-prefpane-account",
		});
		try {
			await win.Zotero_Preferences.waitForFirstPaneLoad();
			let doc = win.document;
			let group = doc.querySelector("#automatic-attachment-downloads-section groupbox");
			assert.equal(group.getAttribute("aria-labelledby"),
				"automatic-attachment-downloads-heading");
			assert.equal(group.getAttribute("aria-describedby"),
				"automatic-attachment-downloads-description");

			for (let type of TYPES) {
				let checkbox = doc.getElementById(`automatic-download-type-${type}`);
				assert.ok(checkbox, type);
				assert.isTrue(checkbox.checked, type);
			}

			let checkbox = doc.getElementById("automatic-download-type-pdf");
			checkbox.checked = false;
			checkbox.dispatchEvent(new win.Event("command", { bubbles: true }));
			assert.isFalse(Zotero.Prefs.get(PREF_PREFIX + "pdf"));

			Zotero.Prefs.set(PREF_PREFIX + "pdf", true);
			await waitForCallback(() => checkbox.checked, 20, 10);
			assert.isTrue(checkbox.checked);
		}
		finally {
			win.close();
		}
	});
});
