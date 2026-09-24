# ZoteroMerge — master agent guide

This is the single maintained project-state and agent guide for **ZoteroCombined** and its sibling **ZoteroCombinedConnector**. Update this file when implementation, build inputs, validation, or remaining work changes. Do not create another planning or handoff document. Upstream submodule documentation remains owned by those projects.

## September 24 installation and build cleanup — complete

The user authorized replacement of the installed app and cleanup of older builds. The normal-use app is now `/Applications/Zotero.app`, version `11.0.SOURCE.deca7b87d`, built from the same `deca7b87d2` code tested below with the test harness excluded. Every common packaged entry matches the tested app except `chrome.manifest`, whose only changes remove the three test-resource registrations. Deep/strict ad-hoc signature verification and a production startup smoke test in a disposable profile passed.

Zotero was quit normally before the swap and reopened from Applications using the existing `9iuhe9dv.default` profile and `/Users/louishess/Zotero/zotero.sqlite`. The running application's Connector endpoint reports the expected new version. The installer did not edit profile or library files. Nine obsolete app bundles, three Desktop release ZIPs, and one obsolete ZIP checksum were moved to Trash. Source repositories, Connector packages, and historical validation records remain. The current isolated test build remains available in `../combined-review/ZoteroComments-20260924/`; its `production-installation.json` and `evidence/removed-builds.jsonl` record the installed package and recoverable cleanup destinations. Long-session behavior and the historical unrelated two-Mac/provider/security work remain separate from this installation result.

## September 24 annotation comments — parallel review build ready

The user-approved annotation-comment fix is implemented in `deca7b87d2`, based on verified baseline `e2a01180c4`, and fast-forwarded into this repository's `ZoteroMerge` branch. File-backed native notifications now update bookkeeping without echoing saved text into active drafts. Peer updates, explicit reloads, and background refreshes defer while edits, saves, deletions, or failed drafts remain pending; coalesced recovery reconciles fresh state under the attachment lock. Failed drafts retain their original expected file identity for retry, and conflict cancellation/recovery updates all peer readers while preserving intrinsic read-only state. Public interfaces, schema, PDF-first persistence, storage modes, dependency lockfiles, and submodule pins are unchanged.

The isolated build is `/private/tmp/zotero-annotation-comments-20260924`. The signed test app, safe launcher, source patch, reproduction scripts, and validation evidence are in `../combined-review/ZoteroComments-20260924/`. The app version is `11.0.SOURCE.deca7b87d`; it is ad-hoc signed and deep/strict signature verification passed. Both app double-click and `Launch Isolated Comment Test.command` create a new disposable Dual-mode profile/library/PDF. The launcher disables account sync, HTTP, app updates, and word-processor installation. Automated test HTTP uses port 23124, separate from the personal app's 23119.

The actual baseline sidebar and popup both reproduced the lost-text race (`AB` reverted to `A`). The final signed package passed **100/100** focused reader/editor/recovery/coordinator/storage-mode/annotation/notification tests and **4/4** annotation sync controls. The launcher fixture passed **1/1**. Corrected native sidebar testing retained multiline text across a pause and produced identical PDF/native comments after closing; disposable database integrity checks returned `ok`. Dual popup, rich-text paste, undo/redo, deletions, and close/reopen persistence pass in the real-editor Gecko tests. Native popup interaction also worked in the initial launcher run, but that run's harness reset to Standard; the launcher now seeds Dual before harness startup. See the artifact `README.md` and named final evidence for exact boundaries and earlier diagnostic logs.

During parallel validation, the personal September 6 app remained running with its original app archive hash, and its profile/database were not used for tests. The subsequent user-authorized installation is recorded above. Long-session personal-library acceptance remains an observational follow-up. Unrelated preexisting guide edits, the Firefox archive, and `TranslatorAgents.md` were preserved. Historical two-Mac/provider, publisher, and security tasks below remain outside this focused fix.

## September 6 update — requested batch complete

The user requested three changes: cloud storage that mirrors desktop collection names above citation article folders; a readable Config Editor with boolean pill switches and discoverable unset settings; and the journal rollout in `TranslatorAgents.md`. The supervisor reviews changes and tests before committing; shared translator files have only one active owner. The September 6 session used ten-subagent configuration limits and Luna XHigh defaults; those historical settings do not prescribe future subagent choices.

Cloud hierarchy and Config Editor implementation passed **100/100** focused Gecko tests on 2026-09-06, covering the manager, migration safety, Advanced Preferences, Config Editor, annotation coordinator and reader notifications. Evidence: `../combined-review/update-integration-tests-final.log`. The Config Editor was also inspected in the disposable native app. Syntax, changed Config Editor lint, Fluent generation and diff whitespace checks passed. The reviewed production app is packaged as `11.0.SOURCE.1e4dabc91` under `../combined-review/ZoteroMerge-20260906/`, with the matching Connector, ZIP archives, checksums and release manifest. Packaged compiled files and all seven changed translators match source; the test runtime is excluded and ad-hoc signature verification passed. The personal library was not migrated during this update.

- Cloud folder paths use desktop collections/subcollections, preserving numeric name prefixes and citation article basenames. A deterministic deepest membership provides one canonical location; articles without collections stay at the root. Names are normalized and sanitized for filesystem portability; genuine collisions receive suffixes. Case-only renames converge after the prior path is freed. Only collection ancestors needed for managed files are materialized.
- Existing managed files relocate with durable copy phases, verified bytes, attachment locks, transactional item/managed/job path updates, database-backed cache reload on rollback, and source cleanup last. Collection changes and reader close trigger reconciliation; open readers defer moves. Hierarchy failures appear in the existing progress details and Retry handles them.
- Config Editor replaces the Advanced-pane `about:config` launcher. It includes all registered preference keys, 223 statically discovered source keys from source/translators, and installed translators' declared hidden defaults. Viewing does not register defaults or create user values. Boolean switches, typed edits, reset, lock handling, filtering and custom keys are supported. Dynamically constructed, never-registered third-party keys still require a custom name; this is not an assertion that arbitrary plugin-defined keys can be discovered before a plugin declares them. `scripts/generate-config-editor-catalog.cjs` runs during `npm run build` and produces `resource/configEditorPrefs.json`.
- `integration/chemistry-journal-coverage.json` tracks 68 explicitly named journal/discovery rows from the guide; family rows still need title/platform-era expansion. Reviewed fixtures now cover Molecules, Catalysts, Journal of Materials Science, Analytical and Bioanalytical Chemistry, Frontiers in Chemistry, JACS, Journal of Organic Chemistry, and Chemical Science. Tetrahedron legacy hardening passes synthetic regressions; current DOM remains access-blocked. No universal chemistry coverage is claimed. Two live controls passed matching Connector-to-Desktop transfer: Springer DOI `10.1007/s10853-025-11859-6` (main PDF + DOCX) and Frontiers DOI `10.3389/fchem.2021.685783` (main PDF + SI PDF). All four saved files passed byte/hash/format checks; evidence is `../combined-review/journal-rollout-browser-transfer-final.log` and `journal-rollout-transfer-audit.json`. Isolated Chromium denied both MDPI controls. Springer older-control video iframes and historical Frontiers API routes remain unverified.

Build environment restored at `/private/tmp/zotero-si-dual-build` from the active source, using offline npm cache plus the pinned public Zotero macOS updater and pinned reader/editor assets. Always sync changed source into that path, build there, and use the harness's disposable profiles. Do not run the full build in the spaced source path. A first expanded test attempt was 99/100 due to missing reader/editor assets; the complete-assets rerun above supersedes it. Keep the historical review/security findings and unfinished two-Mac/provider gates below distinct from this requested feature update.

The user capped the late-night remaining work at five journals. That final batch is complete: Polymers, Organic Letters, Beilstein Journal of Organic Chemistry, Materials, and Chemical Communications. All journal agents in that batch used Luna XHigh. Across this update, **13 named-journal fixture suites** pass, plus the **six ScienceDirect legacy regressions** and **eight Connector harness checks** (overlapping counts). Source implementation and reviewed commits are complete for this capped update; remaining inventory rows are explicitly deferred at the user’s request. Fixture success and the two recorded current-layout transfers do not imply that every publisher layout or file type transfers. Broader historical two-Mac/provider/security release work below remains separate from this feature update.

## Current state

Both active repositories now use `ZoteroMerge`, created from Desktop `637a88cca9` and Connector `6593354`. The integration baseline is built and previously tested; ZoteroMerge completion work is in progress. The baseline integration branches have tracking refs; verify remote state instead of assuming they are unpublished. The separate original checkouts are rollback/reference copies and contain unrelated uncommitted work; do not reset or clean them.

- Desktop source: `ZoteroCombined/` (this repository).
- Connector source: sibling `ZoteroCombinedConnector/`; this is a separate extension build, not a Desktop subdirectory.
- Current review artifacts: sibling `combined-review/ZoteroMerge-20260905/`, containing `Zotero.app`, `connector-manifestv3/`, ZIP archives, checksums and `release-manifest.json`. The preceding `Zotero-SI-Dual-20260904/` baseline remains preserved.
- Build/test workspace: `/private/tmp/zotero-si-dual-build`. This is disposable; the two active source repositories are durable and independent of the original worktrees.
- Evidence: sibling `combined-review/` contains build/test logs and the original-state snapshots. These are evidence and rollback material, not active instructions.
- `integration/source-manifest.json` records source inputs. The external artifact `release-manifest.json` records the exact final commits, application version, lockfile hashes, and packaged checksums. Use `git rev-parse HEAD` for the current source revision; do not put a self-referential commit hash in a committed manifest.

The reviewed ZoteroMerge build includes supplementary-information (SI) downloads, Standard/PDF-only/PDF-and-Zotero annotation modes, built-in cloud folders and automatic-download controls. Local automated gates pass; full acceptance remains unfinished until the live gates below pass. Historical plugin and isolated-download-branch instructions are superseded by the user-approved scope below.

## Authorized completion scope and execution protocol

The user approved the completion plan. The root agent chooses whether to delegate and selects subagent roles, models, and reasoning effort using its judgment for each task; no fixed model or effort is required (user update, 2026-09-24). The root agent supervises, reviews interface requests and diffs, integrates shared files, runs final gates, and makes milestone commits. **Subagents must not commit, push, reset, clean, change branches, or stage files.** Work only within assigned file ownership. Read this guide before editing. Ask the supervisor before changing a shared interface or another owner's files; continue independent assigned work while awaiting the response.

- Deliver a macOS app and matching Chrome Connector on `ZoteroMerge`; no plugin extraction, public release, notarization, or personal-library migration is required.
- Cloud organization is built in, disabled until configured, and covers existing/new downloaded single-file attachments beneath personal-library journal articles: main PDF plus all SI formats, including unknown formats. Exclude snapshots, URL-only links, unmanaged existing linked files, groups and unsupported parent/library categories. PDF annotation rules apply only to PDFs.
- Use a stable ACS plain-text bibliography folder name, NFC normalization, maximum 100 code points (shorter for filesystem byte limits), collision suffixes within limits, and preserved attachment extensions. Metadata edits do not automatically rename folders. Never merge identities based on filenames or equal bytes. Conflicting reparent/merge folder mappings need explicit resolution.
- Use `baseAttachmentPath` and relative linked paths, never a cloud API or cloud-hosted Zotero database. One explicitly enrolled organizer converts files; other desktops acquire, sync, read and annotate. Ownership claims are not distributed locks: unexpected claims/conflict copies stop conversion and preserve data.
- Preserve resumable durable phases separately from waiting/error state. Source erasure is last, after current source/destination identity, linked item, child annotations, metadata, relations and full-text transfer or durable reindex disposition are verified. Serialize migration with annotation writes and reader opening. Recover idempotently from each phase; never silently discard incomplete prototype jobs.
- Cloud bytes remain on ordinary Zotero Trash and noninteractive deletion. Explicit permanent managed-file removal revalidates current identity and uses recoverable Trash; orphan review retains changed/unavailable/ambiguous files. Legitimate annotation edits must update managed revision evidence.
- Integrate seven default-enabled, device-local automatic-download controls: PDF, DOCX, MD, XLSX, MP3, MP4, WEBM. Existing local files still migrate when their download toggle is off. Explicit downloads and forced recovery bypass filtering. Unknown types keep stock behavior. Preserve the SI and associated-files gates independently.
- Reconcile every affected attachment, including closed PDFs and multi-attachment notification batches. Preserve PDF-first Dual writes, native sync changes, conflict/read-only behavior, key generations, and tombstones. Attachment conversion transfers coordinator state without erasing annotation identities.

### Ownership and interfaces

Initial parallel assignments: cloud owner owns only `linkedFolderAttachmentManager.js`, `linkedFolderProviders.js` and their dedicated tests; annotation owner owns `annotationStorageCoordinator.js`, `reader.js` and dedicated coordinator tests; download owner owns `automaticAttachmentDownloads.js`, `translation/translate_item.js`, `storage/storageLocal.js` and its dedicated tests. The supervisor owns startup/module registration, preference defaults/UI, locales/styles, Connector integration, this guide, manifests, and all commits. Further assignments must explicitly name ownership changes. The download owner has additionally been assigned Desktop `server/server_connector.js` and its tests, plus Connector `src/common/connector.js`, `itemSaver.js`, `itemSaver_background.js` and related tests for the runtime policy bridge. The download owner has now completed that milestone and owns only the independent `test/tests/linkedFolderMigrationSafetyTest.js` for further cloud-safety regression work. The annotation owner additionally owns `test/tests/annotationReaderNotificationTest.js`. The supervisor alone stages and commits tested snapshots; newer subagent worktree changes must remain intact.

Retain mode values and `PDFWorker.readAnnotations()` / `applyAnnotationChanges()` contracts. Retain coordinator `reconcile()`, `applyChanges()`, `resolveConflicts()`; agree migration exclusion and state-transfer additions with the supervisor before consumers use them. Preserve `AutomaticAttachmentDownloads.classify()`, `isTypeEnabled()`, `shouldDownload()`, `shouldDownloadItem()`. Providers remain filesystem profiles. Manager additions include explicit organizer claim/release, versioned migration progress plus wait status, and orphan review. UI calls `getOrganizerStatus()`, `claimOrganizer()`, `releaseOrganizer()`, `getOrphans(libraryID)`, and `reviewOrphan(libraryID, attachmentKey, action)` with reveal/retain/dismiss/trash actions. Coordinator migration contract is `withAttachmentLock(ids, callback, existingToken = null)` with a live token passed to `reconcile(id, reason, token)`, `transferState(oldID, newID, {lockToken: token})`, and `clearLocalState(oldID, token)` after verified transfer. Extend the source token to the replacement for the entire transfer and verification callback. Do not use nonexistent begin/end migration methods or clear state as a transfer fallback.

Subagent handoff: changed files, interface changes, tests actually run and results, tests pending with reasons, known failure paths, and review requests. Do not create competing plan/handoff documents. Do not modify upstream submodules or dependency lockfiles without assignment. Use focused tests during development; only the supervisor runs the shared staged Desktop runtime to avoid test-profile/build races.

### Completion gates and live evidence

1. Source baseline and reproducible inputs, with reference work preserved.
2. Download-policy tests across automatic and explicit acquisition; preserve six SI publishers.
3. Cloud migration safety and restart tests across every durable phase, path/root mutations, missing files, reader races, disk/permission failure and organizer conflicts.
4. All annotation types and six transitions, closed-reader and multi-attachment changes, two readers, file/data delivery order, deleted-key protection and conversion state transfer.
5. Accessible settings and actionable configuration, waiting, conflict, handover, deletion and orphan recovery.
6. Current main-PDF/SI byte transfers for Nature, Cell, ACS, RSC, Science and Wiley, using open-access controls in disposable libraries; authentication only if access actually requires it.
7. Real two-Mac tests for **each of Box Drive, Dropbox and Google Drive**, including different base paths, offline edits, placeholders, cloud conflict copies, organizer handover and restart. Simulators do not satisfy this gate. Missing accounts/devices remain pending, never passed.
8. Pinned production macOS build, ad-hoc signing verification, matching Connector package, checksums, release manifest and recovery instructions. No completion claim until every required gate has evidence.

### Current execution record

- Baseline branches created; source worktrees clean at start.
- Cloud seed: original annotation checkout commit `e8bd987d02` plus later uncommitted safety corrections must be reviewed as source inputs, not blindly cherry-picked.
- Download seed: relevant uncommitted source/tests in sibling `ZoteroAutomaticDownloads`; exclude materialized LFS updater binaries and regenerate Fluent output.
- Supervisor integrated shared cloud/download UI and startup modules; implementation and local integration gates are complete as recorded below.
- Download policy milestone: reviewed four Desktop source/test files and verified 10/10 runtime tests, including translator/OA filtering, forced storage recovery, uploads, and settings. The Desktop/Connector policy bridge is also reviewed and committed. Evidence: sibling `combined-review/zoteromerge-download-tests.log`.
- Desktop Connector bridge: all 38 server tests and all ten download-policy tests pass in the combined cloud/bridge run. The server exposes a versioned policy and skips disabled automatic file/OA acquisition while retaining standalone endpoints. Evidence: `combined-review/zoteromerge-cloud-bridge-tests.log` (63/73 overall; the ten failures are isolated cloud provider/manager cases). The matching Connector browser suite passed 113 tests, with nine opt-in live diagnostics pending, including the final linked-URL regression correction. Evidence: `combined-review/zoteromerge-connector-tests.log`. Desktop bridge commit: `740fd09985`; Connector bridge commit: `c85b868`.
- UI milestone: added organizer enrollment/status, retained-file review, all-format cloud descriptions and seven download settings. Settings suite passed 23/23; after correcting pane-unload cleanup, Advanced Settings recheck passed 14/14 with no dead-object errors. Those early SQL errors were corrected; the later 261/261 combined run supersedes the initial cloud snapshot. Evidence: sibling `combined-review/zoteromerge-settings-lifecycle-tests.log`.
- 2026-09-05 worker baseline validation: `npm run typecheck` passed; `npm run test:pdf` passed 188/188. Evidence: sibling `combined-review/zoteromerge-worker-tests.log`. Worker source remains pinned to `731026106dabe56aef921351b7c3480678ee25fc`.
- User confirmed no second Mac is currently available; Dropbox and Google Drive folders are not yet configured. These real-provider/two-Mac gates remain pending. Do not substitute simulations for them or mark the full goal complete.
- Current unauthenticated publisher discovery: Nature passed with a main PDF and 21 SI descriptors; ACS, Cell, RSC, Science and Wiley returned browser-verification pages. These are access-blocked diagnostics, not evidence of broken translators or successful file transfers. Evidence: `combined-review/zoteromerge-live-publisher-discovery.log` and its compact summary JSON.
- User clarified to use open-access controls; no publisher sign-in is assumed necessary. A separate visible Chrome for Testing session and disposable Zotero library are prepared under `/private/tmp/zoteromerge-live-acceptance/`. Test Connector `connector.url` must remain `http://127.0.0.1:23129/`; the existing personal Zotero listens on port 23119 and must never receive test saves. Verify the test process has the disposable database open before enabling live transfers. Browser endpoint state and local harness adaptations stay outside source/artifact packages. Do not log credentials or copy the browser profile into evidence.

### Current live transfer audit (2026-09-05)

Evidence: `combined-review/zoteromerge-live-library-audit.json` maps each disposable parent DOI to its saved attachments, source URLs, file hashes and format checks. The test Desktop was stopped before SQLite inspection; database integrity is `ok`. The personal library was untouched.

- Nature: complete current transfer control, one parent with 22 valid imported files: main PDF + 3 SI PDFs + 18 XLSX. All spreadsheet archives validate. This is file-transfer evidence, not a live cloud/annotation acceptance claim.
- ACS: one valid Figshare SI PDF saved; main PDF request returned HTTP 403 HTML. Incomplete.
- Cell (Heliyon open-access control): one valid CDN SI PDF saved; main PDF request returned HTTP 403 HTML. Incomplete. The PubMed URL-only child is not a transferred file.
- RSC: parent and three MP4 descriptors found; no file transferred. A normal SI request returned HTTP 403 HTML. DOI casing changed to lowercase and is semantically unchanged.
- Science: article and two SI links visible, but citation-export POST returned HTTP 403 before item creation. No transfer.
- Wiley: official full/abstract publisher pages identify the control as Free Access, but the local browser still shows a verification page. No transfer.
- Connector test-only follow-up commit `e94f0ff` prevents SI PDFs from counting as the primary PDF and compares DOI values case-insensitively. Two focused tests pass (`zoteromerge-live-harness-regression.log`). The packaged Connector runtime remains built from `c85b868`; these later changes affect tests only. Earlier ACS/Cell harness passes without the required-primary flag do not satisfy the gate.
- HTTP access evidence is in `zoteromerge-live-attachment-http-summary.json` and `zoteromerge-live-science-http-summary.txt`. Do not infer a translator defect or bypass publisher verification from HTTP 403. The separate browser remains available for normal manual access checks; relaunch only the disposable Desktop/profile before resuming saves.

- Packaged UI observation: the disposable library path and selected Dual mode were visible, and all cloud controls were present. Provider selection persisted, but base-folder selection was not completed reliably: computer-use capture errors and a dropped path prefix prevented a valid choice. No corresponding JavaScript exception was found. Do not treat this as a source defect or as successful manual migration. Evidence: `combined-review/zoteromerge-packaged-ui-observation.json`. The disposable app is stopped with organization disabled; all 24 imported files remain, zero linked attachments were created. A reliable manual app migration/editor check is still pending.

### Open review findings (update as resolved)

- Existing Reader suite passed 13/13, including native CRUD, PDF-only edits/deletion, all supported types, rapid edits/reopen, external-file rejection, two readers, tab transactions and EPUB imports. Evidence: `combined-review/zoteromerge-reader-latest.log`. Persistent callbacks acquire fresh coordinator tokens. Background recovery respects native-mode boundaries and unsaved iframe annotations, and applies snapshots under the attachment lock. The later 261/261 combined gate includes the final polling and reader changes.
- Combined final milestone Reader/coordinator/notification suite passed 43/43: `combined-review/zoteromerge-annotation-milestone-tests.log`. Coordinator passed 24/24; notification tests passed 6/6, including real `Reader.open()` initialization interleaved with migration locking. Closed PDFs, multi-attachment batches, tombstones and all six transitions are covered. Evidence: `combined-review/zoteromerge-annotation-recovery-recheck.log` and `combined-review/zoteromerge-cloud-recovery-finalcheck.log`; their overall counts include unrelated failures recorded below.
- Annotation mode, native annotation and data-sync regression suite passed 100/100: `combined-review/zoteromerge-annotation-sync-regression.log`. Counts overlap with prior runs; do not sum them as unique tests.
- Source PDFs reconcile before hashing under the migration lock. Source/target locks span child/state transfer and verification. Primary/SI conversion, metadata/relations, full-text reindex retry, managed revision checks and ownership/root conflict protection have passing cases.
- The full reviewed cloud suite passed 39/39 in `combined-review/zoteromerge-cloud-reviewed-tests.log`. The earlier cloud/notification suite reached 42/45. The three failing fixtures were corrected and then passed 3/3 in `combined-review/zoteromerge-cloud-boundary-recheck.log`: preserve the actual already-sanitized source filename, pause at the durable copied-temp database checkpoint, and use a valid PDF note annotation for interrupted erasure. The subsequent full run includes those corrections.
- Interrupted erasure now records durable authorization before storage side effects, and revalidates the target, metadata, children, root and organizer on restart. The regression removes source bytes and never restores them. Early source disappearance remains a distinct waiting condition. Keep these conditions when refining recovery.
- Cloud-generated conflicting owner/root claim copies now stop conversion. Only exact current-installation temporary claim filenames are exempt. Explicit retry must preserve the prior durable phase and revalidate the resolved state; the additional explicit retry regression exposed a stale-job race, now fixed by resetting and resuming inside the same per-parent queue. The focused retry test passes.
- Closed relative linked PDFs now have a provider-neutral 30-second metadata polling fallback independent of organizer enrollment. Dual mode reconciles changed/returned files; successful unchanged snapshots are skipped, deferred work retries, and explicit conflicts wait for a changed token or real notification. Shutdown drains active work. The dedicated 13/13 suite covers two real changed PDFs without notifications, unavailable/returning paths, unchanged-file skipping, mode changes, deferred retry, timer nonoverlap and edits arriving during reconciliation. Evidence: `combined-review/zoteromerge-background-pdf-tests.log`. Absolute linked files retain existing notification/opening behavior.
- Advanced Settings passed 14/14, including distinct folder/ownership conflict messages and disabled migration controls: `combined-review/zoteromerge-settings-recheck.log`. Permanent-deletion UI passed 3/3, proving cloud cleanup follows successful database erasure and declined cleanup retains files: `combined-review/zoteromerge-trash-ui-tests.log`.
- Final combined Desktop regression passed **261/261**, including reader/coordinator/polling, annotation modes/data sync, preferences, download policy, cloud safety and Desktop Connector endpoints. Evidence: `combined-review/zoteromerge-final-desktop-regression.log`. The unchanged Connector source matches its tested snapshot: **113 passing, nine opt-in live diagnostics pending**. The production Desktop app was built from `927ca77a36` as `11.0.SOURCE.927ca77a3`, packaged without the test runtime, and ad-hoc signature verification passed. Its 16 changed compiled feature files and embedded defaults match the build snapshot; the pinned worker and all six publisher translators match exactly. Evidence: `combined-review/zoteromerge-production-build.log`, `zoteromerge-signature-verification.log`, and `zoteromerge-packaged-content-check.json`. The matching Connector is the tested unpacked debug/review extension; no public-store signing or publication is included. Final documentation-only commits do not change the packaged app code. Real two-Mac Box/Dropbox/Google Drive checks and the remaining five publisher transfer controls remain pending; local simulations and historical transfers do not satisfy them.

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

## Review build and recovery procedure

- Use a disposable Zotero profile/library for acceptance. The current app has not been opened against the personal library. The archive and unpacked Connector are review artifacts, not a public/notarized release.
- In Advanced → Files and Folders, choose the Linked Attachment Base Directory and provider, enable cloud folders and explicitly enroll one organizer. Preview before starting migration. Choose PDF-and-Zotero in PDF Annotations for the mirrored system. On other computers, configure their local path to the same cloud folder and use normal Zotero data sync; do not enroll a second organizer.
- A waiting job retains its durable progress. Restore folder availability or finish closing the reader, then Resume or Retry. A conflict requires inspecting and resolving the indicated file/ownership problem before explicit Retry; do not discard migration settings or replace verification hashes to force progress.
- For annotation conflicts, compare the PDF and Zotero versions in the conflict dialog. Cancel preserves the conflicting content and leaves the reader read-only. Reopen after resolving the underlying condition. Background checks never choose a conflict winner.
- Ordinary Zotero Trash retains cloud bytes. Permanent item deletion asks separately whether to move managed files to macOS Trash. Changed or unavailable files are retained for orphan review. Restore files from macOS Trash to their original relative path when undoing that file removal; restoring a permanently deleted Zotero item requires the library backup/data recovery path.
- After an interrupted conversion, restart with the same root and organizer records. The job rechecks target bytes, metadata, children and ownership before completing. The stored source is erased only after verification; an already authorized interruption with missing source bytes resumes from the verified target. Do not manually delete the retained source, target or job records during recovery.
- The remaining acceptance needs a second Mac and configured disposable Box, Dropbox and Google Drive folders, plus current open-access main-PDF/SI transfers from all six SI publishers. The user has no second Mac presently and Dropbox/Google Drive are not configured. Keep those gates pending; do not migrate the personal library or declare the full goal complete.

## Remaining work and historical context

ZoteroMerge local automated validation and review packaging are complete as recorded above. Manual acceptance remains pending for the remaining publisher transfers, cross-provider case/Unicode/long-filename portability, and independent real file/data-sync delivery between Macs. Do not report these live gates as completed. The combined tests migrated only disposable files and did not write to the personal library.

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
