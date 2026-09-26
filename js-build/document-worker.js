'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);
const { getSignatures, writeSignatures, onSuccess, onError } = require('./utils');

const sharedAssetDirs = ['cmaps', 'standard_fonts'];
const requiredFiles = ['worker.js', 'metadata.json', 'structured-document-text.js'];

async function getDocumentWorker(signatures) {
	const t1 = Date.now();

	const modulePath = path.join(__dirname, '..', 'document-worker');
	const targetDir = path.join(__dirname, '..', 'build', 'resource', 'document-worker');

	const hash = await getSourceHash(modulePath);

	if (!('document-worker' in signatures)
			|| signatures['document-worker'].hash !== hash
			|| !(await isBuildReady(targetDir))) {
		// This worker contains local annotation changes and is built from owned source.
		await execFile('npm', ['ci'], { cwd: modulePath, maxBuffer: 10 * 1024 * 1024 });
		await execFile('npm', ['run', 'build'], { cwd: modulePath, maxBuffer: 10 * 1024 * 1024 });
		let missingFiles = await getMissingFiles(path.join(modulePath, 'build'));
		if (missingFiles.length) {
			throw new Error(`Local document-worker build is missing ${missingFiles.join(', ')}`);
		}
		await fs.remove(targetDir);
		await fs.copy(path.join(modulePath, 'build'), targetDir);
		signatures['document-worker'] = { hash };
	}

	for (let dir of sharedAssetDirs) {
		await fs.remove(path.join(targetDir, dir));
	}

	const t2 = Date.now();

	return {
		action: 'document-worker',
		count: 1,
		totalCount: 1,
		processingTime: t2 - t1
	};
}

async function getSourceHash(modulePath) {
	const { stdout } = await execFile('git', ['ls-files', '--stage', '-z', '.'], { cwd: modulePath });
	const hash = crypto.createHash('sha256');
	for (let entry of stdout.split('\0').filter(Boolean)) {
		let [metadata, filename] = entry.split('\t');
		let [mode, object, stage] = metadata.split(' ');
		if (stage !== '0') throw new Error('Resolve worker source conflicts before building');
		hash.update(mode + '\0' + filename + '\0');
		if (mode === '160000') {
			let dependency = path.join(modulePath, filename);
			if (!(await fs.pathExists(path.join(dependency, '.git')))) {
				throw new Error(`Initialize worker dependency ${filename} before building`);
			}
			let { stdout: revision } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: dependency });
			let { stdout: dirty } = await execFile('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: dependency });
			if (dirty.trim()) throw new Error(`Worker dependency ${filename} has uncommitted source changes`);
			hash.update(object + '\0' + revision.trim());
		}
		else {
			hash.update(await fs.readFile(path.join(modulePath, filename)));
		}
		hash.update('\0');
	}
	const { stdout: untracked } = await execFile('git', ['ls-files', '--others', '--exclude-standard', '-z', '.'], { cwd: modulePath });
	for (let filename of untracked.split('\0').filter(Boolean).sort()) {
		hash.update('untracked\0' + filename + '\0');
		hash.update(await fs.readFile(path.join(modulePath, filename)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

async function isBuildReady(targetDir) {
	return !(await getMissingFiles(targetDir)).length;
}

async function getMissingFiles(targetDir) {
	let missingFiles = [];
	for (let file of requiredFiles) {
		if (!(await fs.pathExists(path.join(targetDir, file)))) {
			missingFiles.push(file);
		}
	}
	return missingFiles;
}

module.exports = getDocumentWorker;
module.exports.getSourceHash = getSourceHash;

if (require.main === module) {
	(async () => {
		try {
			const signatures = await getSignatures();
			onSuccess(await getDocumentWorker(signatures));
			await writeSignatures(signatures);
		}
		catch (err) {
			process.exitCode = 1;
			global.isError = true;
			onError(err);
		}
	})();
}
