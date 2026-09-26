import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const TRANSLATOR_DIR = new URL('../../../translators/', import.meta.url);

async function loadTranslator(fileName) {
	let code = await readFile(new URL(fileName, TRANSLATOR_DIR), 'utf8');
	code = code.replace(/^\s*{[\s\S]*?}\s*?[\r\n]/, '');
	let context = {
		URL,
		ZU: {
			trimInternal(text) {
				return text.replace(/\s+/g, ' ').trim();
			}
		}
	};
	vm.runInNewContext(code, context, { filename: fileName });
	return context;
}

function fakeLink({ href, text = '', download = null, containerText = null }) {
	return {
		href,
		textContent: text,
		getAttribute(name) {
			return name === 'download' ? download : null;
		},
		closest() {
			return containerText === null ? null : { textContent: containerText };
		}
	};
}

describe('Publisher supplementary translator helpers', function () {
	it('classifies and deduplicates current RSC files without changing link mode', async function () {
		let translator = await loadTranslator('RSC Publishing.js');
		let mp4 = fakeLink({
			href: 'https://pubs.rsc.org/ma/article-supplement/1287895/mp4/d6ma00514d1_suppl/',
			containerText: 'Supplementary movie 1'
		});
		let namedPDF = fakeLink({
			href: 'https://pubs.rsc.org/ma/article-supplement/1287895/file/d6ma00514d4_suppl/',
			download: 'd6ma00514d4_suppl.pdf',
			containerText: 'Supplementary information'
		});
		let unknown = fakeLink({
			href: 'https://pubs.rsc.org/ma/article-supplement/1287895/bin/d6ma00514d5_suppl/',
			containerText: 'Supplementary archive'
		});
		let doc = { querySelectorAll: () => [mp4, mp4, namedPDF, unknown] };

		let downloaded = translator.getSupplementaryAttachments(doc, false);
		assert.lengthOf(downloaded, 3);
		assert.equal(downloaded[0].mimeType, 'video/mp4');
		assert.isTrue(downloaded[0].snapshot);
		assert.equal(downloaded[1].mimeType, 'application/pdf');
		assert.isTrue(downloaded[1].snapshot);
		assert.isUndefined(downloaded[2].mimeType);
		assert.isFalse(downloaded[2].snapshot);

		let linked = translator.getSupplementaryAttachments(doc, true);
		assert.isTrue(linked.every(attachment => attachment.snapshot === false));
	});

	it('extracts only concrete Science.org supplementary downloads', async function () {
		let translator = await loadTranslator('Atypon Journals.js');
		let pdf = fakeLink({
			href: 'https://www.science.org/doi/suppl/10.1126/science.adt5229/suppl_file/science.adt5229_sm.pdf',
			download: 'science.adt5229_sm.pdf'
		});
		let zip = fakeLink({
			href: 'https://www.science.org/doi/suppl/10.1126/science.adt5229/suppl_file/science.adt5229_data_s1_and_s2.zip',
			download: 'science.adt5229_data_s1_and_s2.zip'
		});
		let material = (link, title) => ({
			querySelector: () => link,
			querySelectorAll: () => [],
			get textContent() { return title; }
		});
		let materials = [material(pdf, 'Supplementary Materials'), material(pdf, 'Duplicate'), material(zip, 'Data S1 and S2')];
		for (let entry of materials) {
			entry.querySelector = selector => selector === '.core-description'
				? { children: [{ textContent: entry.textContent }] }
				: entry === materials[2] ? zip : pdf;
		}
		let doc = {
			location: { href: 'https://www.science.org/doi/10.1126/science.adt5229' },
			querySelectorAll: () => materials
		};

		let attachments = translator.getScienceSupplementaryAttachments(doc, false, doc.location.href);
		assert.lengthOf(attachments, 2);
		assert.sameMembers(attachments.map(attachment => attachment.mimeType), [
			'application/pdf',
			'application/zip'
		]);
		assert.isTrue(attachments.every(attachment => attachment.snapshot === undefined));
		assert.deepEqual(
			translator.getScienceSupplementaryAttachments(doc, false, 'https://example.com/article'),
			[]
		);
		assert.isTrue(translator.getScienceSupplementaryAttachments(doc, true, doc.location.href)
			.every(attachment => attachment.snapshot === false));
	});

	it('classifies and deduplicates Wiley file-table downloads', async function () {
		let translator = await loadTranslator('Wiley Online Library.js');
		let docx = fakeLink({
			href: 'https://onlinelibrary.wiley.com/action/downloadSupplement?doi=10.1111%2Ftpj.14950&file=tpj14950-sup-0001-Supinfo.docx',
			text: 'Supporting Information'
		});
		let xlsx = fakeLink({
			href: 'https://onlinelibrary.wiley.com/action/downloadSupplement?doi=10.1111%2Ftpj.14950&file=tpj14950-sup-0002-TableS1-S8.xlsx',
			text: 'Table S1-S8'
		});
		let unknown = fakeLink({
			href: 'https://onlinelibrary.wiley.com/action/downloadSupplement?doi=10.1111%2Ftpj.14950&file=tpj14950-video.mov',
			text: 'Video'
		});
		let section = { querySelectorAll: () => [docx, xlsx, docx, unknown] };
		let doc = { querySelectorAll: () => [section, section] };

		let downloaded = translator.getSupplementaryAttachments(doc, false);
		assert.lengthOf(downloaded, 3);
		assert.equal(downloaded[0].mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		assert.equal(downloaded[1].mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		assert.isUndefined(downloaded[2].mimeType);
		assert.isFalse(downloaded[2].snapshot);
		assert.isTrue(translator.getSupplementaryAttachments(doc, true)
			.every(attachment => attachment.snapshot === false));
	});
});
