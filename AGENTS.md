# Combined Zotero project — master agent guide

This is the single maintained project-state and agent guide for **ZoteroCombined** and its sibling **ZoteroCombinedConnector**. Update this file when implementation, build inputs, validation, or remaining work changes. Do not create another planning or handoff document. Upstream submodule documentation remains owned by those projects.

## Current state

Both active repositories use branch `integrate/si-and-dual-annotations`. The Desktop merge and matching Connector build are complete locally and ready for review and further work. Neither branch has been pushed. The separate original checkouts are rollback/reference copies and contain unrelated uncommitted work; do not reset or clean them.

- Desktop source: `ZoteroCombined/` (this repository).
- Connector source: sibling `ZoteroCombinedConnector/`; this is a separate extension build, not a Desktop subdirectory.
- Review artifacts: sibling `combined-review/Zotero-SI-Dual-20260904/`, containing `Zotero.app`, `connector-manifestv3/`, and `release-manifest.json`.
- Build/test workspace: `/private/tmp/zotero-si-dual-build`. This is disposable; the two active source repositories are durable and independent of the original worktrees.
- Evidence: sibling `combined-review/` contains build/test logs and the original-state snapshots. These are evidence and rollback material, not active instructions.
- `integration/source-manifest.json` records source inputs. The external artifact `release-manifest.json` records the exact final commits, application version, lockfile hashes, and packaged checksums. Use `git rev-parse HEAD` for the current source revision; do not put a self-referential commit hash in a committed manifest.

The included functionality is supplementary-information (SI) downloads plus Standard, PDF-only, and PDF-and-Zotero annotation modes. The later linked-cloud-folder extension and separate uncommitted automatic-download controls are **not included**. Do not treat their old planning documents or worktrees as implemented behavior in this branch.

## History and exact feature inputs

| Input | Revision |
| --- | --- |
| Annotation base | `52ac324e2bc9ed3df7726bd098997155293bf4ac` |
| SI Desktop tip merged | `522858cc890bb83ff71a1725a332ac5c7dc2fab9` |
| Desktop merge | `c376949763febbfb7a2814e80cf32b62d2aee227` |
| Translator-pin integration | `761b7eeb5ff472d485687822eb624f5e67e5c7b6` |
| Validated integration code/tests | `c3d91b11a0e685af7f225b4591ac77ed936ab326` |
| Connector feature source | `4c0baf1a7a975b31867eb9a1280aaf5a3fdd9925` |
| Connector-compatible `src/zotero` | `4c05017a60b7f418ead44467225ac78c31559c23` |
| Publisher translators | `70e15ee76959b45d7404e780ec5f7f7fbc5acde2` |
| Annotation document-worker | `731026106dabe56aef921351b7c3480678ee25fc` |

Both Desktop feature lines already contained `6855f07d4a` (translator preference server bridge) and `1cec11b733` (early SI translators). Their merge base was `1cec11b733`; do not replay those shared commits. The real merge had no textual conflict: it preserved annotation defaults and changed the separate SI default hunk. Later cleanup commits only consolidate documentation and manifests.

The five translator commits after the old annotation pin `0d77dbaf` add Cell CDN delivery, ACS Figshare, RSC, Science/Atypon, and Wiley. Nature is already in the earlier ancestry. Keep the Connector-compatible Zotero pin; replacing it with the combined Desktop commit previously required compatibility correction.

## Product invariants

### SI and Connector

- Desktop exports primitive `extensions.zotero.translators.*` preferences through `/connector/ping`, with `translatorPrefsVersion: 1`.
- Desktop values override Connector-local values only while connected. Refresh both background/injected and MV3 offscreen translation contexts; clear overrides on disconnect without overwriting local preferences.
- `translators.attachSupplementary=true` is the Desktop default; `translators.supplementaryAsLink=false` enables files rather than links. Preserve explicit user preferences and the independent `downloadAssociatedFiles` gate.
- SI adds attachments without breaking citation metadata or the working main-PDF route. A publisher's isolated-browser HTTP 403 does not establish a broken URL; normal authenticated access may work.
- Nature uses direct media download links and excludes figure pages. Cell uses official Elsevier CDN SI URLs. ACS uses Figshare discovery and a narrow User-Agent exception only for `https://ndownloader.figshare.com/files/` XHRs. Do not broaden it to ACS article/PDF domains.
- RSC recognizes current supplementary routes, Science's extractor is narrowly scoped within the shared Atypon translator, and Wiley uses its supporting-information file table. Preserve link mode, MIME mapping, normalized-URL deduplication, and unknown-format fallbacks.

### Annotation storage

- Modes are `standard`, `pdf-only`, and `pdf-and-zotero`. Fresh profiles default to Standard.
- Preserve preference migration version 23: explicit old `saveToFile=false` maps to Standard; explicit true and the former default-without-user-value map to PDF-only. Write/validate the new mode before clearing the old user preference.
- In Dual, write and verify the PDF before the native database mirror. The PDF is authoritative for crash recovery. Preserve bidirectional reconciliation for independent file and Zotero data-sync changes.
- Standard stores native annotations only, PDF-only stores them in the PDF only, and Dual stores one embedded/native pair with matching identity. Unsupported sessions (groups, read-only PDFs, EPUB/snapshot, non-editable libraries) retain stock behavior.
- Preserve stable IDs within a storage generation. Transitions leaving database-backed modes must rotate PDF IDs before erasing native items. Never recreate an erased Zotero key, which may already exist in a sync delete log.
- Tombstones represent user deletion, never removal of one representation during conversion. Preserve unrelated/unsupported external annotations.
- Reconcile one-sided changes against common digests. Concurrent changes or ambiguous identities require explicit resolution. Cancel leaves conflicting content unchanged and opens read-only. Preserve external-file-token checks, exact-source deletion, per-attachment serialization, and two-reader coordination.
- Keep `PDFWorker.readAnnotations()` / `applyAnnotationChanges()` and coordinator `reconcile()`, `applyChanges()`, `resolveConflicts()` contracts aligned. New reconciliation tests belong in `test/tests/annotationStorageCoordinatorTest.js`, not additional edits to `readerTest.js`.

### Filename and shared-file rules

- Keep repository paths distinct. Desktop `defaults/preferences/zotero.js`, Desktop `xpcom/zotero.js`, and Connector `src/common/zotero.js` are different files with different roles. Never flatten projects by basename or resolve shared files wholesale with ours/theirs.
- Two main/SI PDFs with the same filename are separate attachment identities and storage paths. Do not deduplicate by title or filename.
- Preserve adjacent atomic worker temporary files `.zotero-annotations-<operationID>-<random>.tmp`; stale annotation writes must not overwrite externally replaced PDFs.
- Fluent `.ftl` files are authoritative for new strings. Regenerate `chrome/locale/en-US/zotero/zotero.json` with `npm run ftl-to-json`; do not concatenate generated JSON. The generator rejects duplicate message keys.
- Retain each repository's own package/lockfiles. Do not include materialized Git LFS updater binaries as accidental source changes.

## Reproducing sources and builds

The checked-in `integration/annotation-worker.bundle` contains four custom worker commits beyond upstream `6d0c0ce45d96a4ed5b697927306b1e9207a02041`. It was verified and avoids dependence on another local worktree's refs. In a fresh **non-recursive** Desktop clone, initialize the worker before the recursive submodule update:

```sh
git clone --no-checkout https://github.com/zotero/document-worker.git document-worker
git -C document-worker bundle verify ../integration/annotation-worker.bundle
git -C document-worker fetch ../integration/annotation-worker.bundle HEAD
git -C document-worker checkout --detach 731026106dabe56aef921351b7c3480678ee25fc
git submodule update --init --recursive
git lfs pull
```

The bundle needs the named upstream ancestor; fetch it first if using a shallow clone. Pin all submodules exactly instead of updating to upstream HEAD.

Build Desktop from an absolute path **without spaces**. The original annotation worktrees have stale submodule paths and must not be used as the build template. Use a fresh clone of the active combined repository. The tested environment was macOS, Node v26.5.0, npm 11.17.0, and the configured Gecko 153.0esr runtime.

```sh
npm ci
npm run ftl-to-json
npm run build
ZOTERO_TEST=0 app/scripts/dir_build -p m -f
codesign --force --deep --sign - --timestamp=none app/staging/Zotero.app
codesign --verify --deep --strict app/staging/Zotero.app
```

Desktop's builder downloads revision-specific reader/editor/worker assets or builds them locally. The custom worker was also built directly from source; `worker.js`, `metadata.json`, and `structured-document-text.js` matched the downloaded revision assets byte-for-byte. The packager verifies the configured Gecko runtime hash and signs the Word integration library. Sign and verify the complete review app separately with the commands above. Verify staged content rather than copying an older application's `omni.ja`.

The staged app is `app/staging/Zotero.app`. Retain this internal name and use a distinct enclosing artifact directory/archive to avoid overwriting installed or previous builds. The review build is not a notarized release. Do not launch it against the user's library merely to test packaging.

For the separate Connector:

```sh
npm ci
./build.sh -d
HEADLESS=true npm test
```

Use Puppeteer's pinned **Chrome for Testing 150.0.7871.24**. Stable Chrome 152 did not register the MV3 worker in this harness. Browser tests needed normal execution outside the restricted sandbox. No source fix was needed. The unpacked extension is `build/manifestv3`.

## Validation and test commands

Zotero is a Mozilla/XUL/XHTML application, not Electron. Desktop tests require its runtime and use Mocha/Chai/Sinon. `CI=1` uses the harness's temporary profile/library with automatic sync disabled; build JS first when using CI mode.

```sh
CI=1 test/runtests.sh server_connector annotationStorageMode annotationStorageCoordinator reader preferences_advanced
CI=1 test/runtests.sh annotations syncLocal
CI=1 test/runtests.sh annotationStorageCoordinator
# In document-worker:
npm ci
npm run typecheck
npm run test:pdf
npm run build
```

The test harness stages a test-enabled application. Repackage with `ZOTERO_TEST=0 app/scripts/dir_build -p m -f` afterward for the review app.

Validated 2026-09-04:

| Check | Result |
| --- | --- |
| Initial focused Desktop suite | 77/77 |
| Annotation/data-sync suite | 90/90 |
| Coordinator after new real-worker tests | 15/15 (8 existing + 7 integration cases) |
| Worker typecheck and local build | Passed |
| Worker PDF suite | 188/188 |
| Six publisher translator syntax checks | Passed |
| Connector build and browser suite | 106 passed; 9 opt-in live diagnostics skipped |
| Separate RSC/Science/Wiley helper run | 3/3 |

Counts overlap; do not sum them as unique tests. The new cases prove same-filename isolation, native parent/path identity, SI edit/deletion without changing the main attachment, reconstruction after clearing local coordinator state, and all six mode transitions. Valid note geometry is 22 points; fixtures must include sortIndex and must not invent highlight text inconsistent with the actual PDF.

Staged checks verified both preference defaults, the preference server bridge, coordinator/conflict UI, six translator files matching source byte-for-byte, and the custom worker. Worker SHA-256 is `96ad07a1d027f338aa01f98e35e97fdfd1779982279982883c19ac3f33365223`. The final artifact manifest records packaged checksums and exact build revisions.

## Remaining work and historical context

Automated integration is complete; manual acceptance is still needed for authenticated live publisher transfers, case-only/Unicode/long filename portability, and independent real file/data-sync delivery. Do not report these as completed. The combined run did not write to the personal library or run cloud migration.

Historical 2026-08-08 normal-profile tests confirmed main PDF + SI transfers for ACS, Nature, and Cell. Those are historical results, not current combined-build tests. Useful controls:

- Nature `10.1038/s41586-026-10843-7`: historical main PDF + 21 SI files (3 PDF, 18 XLSX).
- ACS `10.1021/jacs.5c22031`: historical main PDF and SI PDF; retain `/doi/pdf/<DOI>` main-PDF routing.
- Cell `10.1016/j.cell.2026.05.012`: historical main PDF and two CDN SI PDFs.
- RSC `10.1039/D6MA00514D`: three MP4 SI descriptors passed live extraction.
- Science positive control `10.1126/science.adt5229`: PDF and ZIP. Supplied `10.1126/science.aef8874` had no SI at the time.
- Wiley positive control `10.1111/tpj.14950`: DOCX and XLSX. Supplied `10.1002/cbf.70276` had no SI at the time.

Science and Wiley isolated runs could fail during upstream metadata requests before SI extraction. Confirm normal authenticated-browser behavior without replacing a working main-PDF path. `LIVE_LIBRARY_TRANSFER=true` writes to the selected library; perform such testing only within the user's authorized scope. Keep source selection, descriptor extraction, byte transfer, and annotation persistence distinct in test reports.

## Working conventions

Core business logic is in `chrome/content/zotero/xpcom/`, loaded through `chrome/content/zotero/zotero.mjs` onto the global `Zotero` namespace. Data objects use async `saveTx()`; SQLite access is through `Zotero.DB`. The reader and worker are separate submodules. UI uses XHTML/custom elements/React, styles use SCSS, and localization uses Fluent. Build output is generated by `js-build/`; the app does not execute raw source files directly.

Use tabs and the surrounding code style. Run focused tests and lint changed lines; do not refactor unrelated code or regenerate dependency locks incidentally. Preserve unrelated working changes and pinned submodules. This master guide replaces the old commit-owner assignments and multi-agent implementation plans; normal user authorization governs ongoing work.
