# Plan: combined supplementary downloads and dual PDF annotations

Prepared 2026-09-04 from local Git history, source diffs, and a read-only three-way merge preview. No source branches, submodules, or application builds were changed. This is a proposed integration, not a tested combined release.

## Recommended scope and source layout

Build one patched Zotero Desktop application and deliver its matching patched Chrome Connector alongside it. The SI fix spans Desktop, Connector, and publisher translators; a Desktop-only merge cannot supply the Connector preference propagation and Figshare transfer changes.

Start a fresh Desktop integration branch, proposed name `integrate/si-and-dual-annotations`, at `52ac324e2b`. This contains the committed dual annotation implementation before the later linked-cloud-folder extension. Merge Desktop SI tip `522858cc8`, then advance the translator submodule to `70e15ee76959b45d7404e780ec5f7f7fbc5acde2`. Retain document-worker `731026106dabe56aef921351b7c3480678ee25fc`.

Use Connector `4c0baf1` from `Zotero SI Fix` as a separate build input. Preserve its compatible `src/zotero` pin at `4c05017a6`; do not replace this with the new Desktop integration commit. Commit `5a7ded2` explicitly restored a Connector-compatible source pin after an earlier Desktop pin.

If the intended combined product must also retain the later linked-cloud-folder feature, start at `e8bd987d02` instead. The same SI merge preview also succeeds against the current annotation HEAD `b61f447fa3`; the additional HEAD commit is a plugin-migration planning document, not an implemented plugin. Linked-folder functionality adds its own validation requirements below. Neither variant includes the separate uncommitted automatic-download controls by default.

## Relevant history

| Component | Commits and significance |
| --- | --- |
| Shared Desktop foundation | `45867cea54` upstream base; `6855f07d4a` exports translator preferences with server tests; `1cec11b733` pins the first publisher SI fixes. Both Desktop feature lines already contain these commits. |
| Later Desktop SI work | `acf089d99` advances translators to `45d4b951`; `522858cc8` changes `translators.attachSupplementary` from false to true. Desktop source is `/Users/louishess/Developer/zotero-si-desktop`. |
| Connector SI | `b05ae51` build paths with spaces; `46384c4` preference bridge; `460ea49` narrow Figshare transfer handling; subsequent tests and pins culminate in `3809d8a`, `c9d4b55`, and handoff `4c0baf1`. |
| Latest publisher SI changes | After the annotation branch's translator pin `0d77dbaf`: `34812520` Cell CDN, `45d4b951` ACS Figshare, `4e3ecd66` RSC, `f3a65dab` Science/Atypon, `70e15ee7` Wiley. Nature's fix is already in the earlier ancestry. |
| File-backed annotation foundation | `da5a8dc259` worker identity; `f6bcaf2f37` atomic persistence; `0da6356591` reader integration; `ee4de0a215` notes; `9fde74c7e9` revision coordination; `bb9a46289e` serialization; `009cfeb780` validation; `3a7f6f4b92` PDF appearances; `73e08c562a` external-change recovery; `5eb0bc8c59` and `19f1bb122f` lifecycle tests. |
| Dual annotation implementation | `99c24973eb` modes and preference migration; `d963c21391` worker reconciliation metadata; `5e5aaa9ec4` coordinator; `2588ee7695` reconciliation/conflict UI; `99f7a614d0` settings dashboard; `52ac324e2b` documentation. |
| Later, separate scope | `e8bd987d02` linked-folder migration; `b61f447fa3` proposed plugin migration. `ZoteroAutomaticDownloads` points at `52ac324e2b` but its actual download-policy implementation is uncommitted. |

The common Desktop merge base is **`1cec11b73303463809d8da263f123c42a957e5dd`**. Do not replay the shared server bridge or early translator commit.

## Shared-file resolution

Read-only `git merge-tree` comparisons of the SI tip against both `52ac324e2b` and current annotation HEAD found no textual conflict. This demonstrates source mergeability, not runtime compatibility.

| Path | Resolution |
| --- | --- |
| `defaults/preferences/zotero.js` | Use the three-way result. Preserve annotation `storageMode="standard"` and the SI `attachSupplementary=true` change, with `supplementaryAsLink=false`. Do not take either entire file with ours/theirs. Preserve the annotation preference migration in `xpcom/prefs.js`; changing a default must not overwrite explicit user preferences. |
| `translators` gitlink | The Desktop merge reaches only `45d4b951`, which is incomplete for the latest SI work. Explicitly pin `70e15ee7` afterward. Keep the translator fork URL and verify the commit exists in the reproducible source repository. Do not copy publisher files over the gitlink. |
| `document-worker` gitlink | Preserve annotation revision `7310261` and its identity, validation, appearance, and reconciliation commits. Verify availability of this custom commit: `.gitmodules` still names upstream `zotero/document-worker`, so a fresh upstream-only recursive clone may not obtain it. Transfer from the local worker repository and establish a durable source for the final build. |
| `xpcom/server/server_connector.js` and its tests | Already shared through `6855f07d4a`; retain one bridge and one version constant. No duplicate implementation is needed. |
| `reader.js`, `pdfWorker/manager.js`, `annotationStorageCoordinator.js`, annotation UI/tests | Preserve annotation implementation. The later Desktop SI commits do not modify these paths. |
| `chrome/locale/en-US/zotero/zotero.json` | Existing working copies contain generated annotation strings. Merge authoritative Fluent sources if necessary, then regenerate with `npm run ftl-to-json`. Do not concatenate JSON or copy one project's generated output wholesale. The generator rejects duplicate message keys. |
| `.gitmodules` | Preserve feature-specific URLs and exact gitlinks. Compare entries by submodule path, not by taking a whole version of the file. Record sources for custom commits. |

Equal basenames in different repositories are not Git conflicts. Desktop `defaults/preferences/zotero.js`, Desktop `xpcom/zotero.js`, and Connector `src/common/zotero.js` serve different roles. Likewise, keep each repository's `package.json`, lockfile, build scripts, README, and test directories in that repository. Do not flatten the projects into one source tree.

If automatic-download controls are added later, export and review that working patch separately. Real overlap then includes `defaults/preferences/zotero.js`, `zotero.mjs`, `xpcom/zotero.js`, `preferences.ftl`, and generated `zotero.json`. Resolve module lists as a union with each module loaded once; initialize the policy after libraries are ready and before dependent work. Keep translation and storage acquisition gates separate from annotation reconciliation. Linked-folder code already tolerates an absent `AutomaticAttachmentDownloads` module through its documented interface. Regenerate localization after combining Fluent messages. Unknown types such as ZIP retain stock policy behavior.

## Filename and PDF safety

1. Keep separate source and output directories for Desktop, Connector, translators, and worker. Build Desktop in a path without spaces, such as `/private/tmp/zotero-si-dual-build`; Desktop build scripts still contain unquoted path interpolation despite the Connector's path fix.
2. Keep the internal staged application name `Zotero.app`, as build/test scripts expect it. Use a distinct enclosing release directory or archive name such as `Zotero-SI-Dual-20260904/` and `Zotero-SI-Dual-20260904.zip`. Put the unpacked extension in its own `connector-manifestv3/` directory. Do not overwrite either existing staged build or the installed app.
3. Preserve normal Zotero attachment-key-based storage. Main PDFs and SI PDFs with identical leaf names are distinct attachments; do not deduplicate or flatten them by filename or title. Translator URL deduplication does not establish file identity across attachments.
4. Preserve the worker's adjacent temporary-file pattern `.zotero-annotations-<operationID>-<random>.tmp`, atomic replacement, file tokens, and per-attachment mutation serialization. Download and annotation writers must not silently replace one another's bytes.
5. Test two different PDFs named `supplement.pdf`, case-only filename differences on macOS, Unicode names, long names, and a downloaded/external replacement while a reader is open. Verify separate attachment identity and that stale annotation writes stop until reload.
6. If linked folders are included, main and SI PDFs share an article folder. Preserve numeric collision suffixes, stable article-folder mapping, SHA-256/size verification, source-key-specific `.zotero-part-<key>` temporary files, and no-overwrite renames. Existing code chooses `name.pdf`, `name (2).pdf`, etc.; test collision races and retry recovery before accepting that behavior. Non-PDF SI must retain its normal supported storage path.

## Execution sequence

1. **Preserve working state.** Record hashes, branches, binary-capable tracked diffs, untracked files, and submodule state outside the source trees. The annotation checkout has uncommitted linked-manager changes, tests, and generated localization. AutomaticDownloads has uncommitted policy, UI, translation/storage hooks, and tests. The SI Desktop has an unrelated modified lockfile. Do not reset, clean, or indiscriminately stash these trees.
2. **Create independent integration checkouts.** The two annotation/download directories are worktrees whose Git common directory is `/Users/louishess/Desktop/ZoteroFileAnnotations/.git`. Annotation `git status` fails on a stale `styles` submodule path; ordinary AutomaticDownloads status hits an LFS filter error. Use fresh checkouts with initialized submodules and valid LFS assets. The updater differences reported with LFS filtering disabled are not established source edits and must be diagnosed before including any binaries.
3. **Merge Desktop histories.** In the new checkout, create the integration branch at the selected annotation revision, fetch the local Desktop SI history, and merge exact SI tip `522858cc8` using a merge commit. Review the defaults hunk and all gitlinks before committing. Follow with a separate translator-pin commit to `70e15ee7`.
4. **Make inputs reproducible.** Record full Desktop, Connector, translator, worker, and other submodule hashes, dependency lockfiles, runtime versions, and local source remotes in a release manifest. Ensure every custom object is available from a durable repository or bundled source snapshot. Never substitute upstream HEAD for a missing feature commit.
5. **Build fresh assets.** Install dependencies from each selected lockfile. Regenerate Fluent-derived JSON. Build the custom worker and Desktop using `npm run build`, then package macOS with `app/scripts/dir_build -p m -f`. Verify the staged `resource/document-worker` corresponds to the patched worker: Desktop's builder first attempts a revision-specific prebuilt download and falls back to a local build. Do not carry over caches or assets from another build. Build Connector separately with `./build.sh -d`.
6. **Validate integration.** Run the checks below against these actual staged artifacts. Record new results; historical SI test counts are not combined-build evidence.
7. **Package for review.** Deliver the distinct Desktop archive, matching Connector folder, source manifest, exact verification commands/results, and installation/rollback notes. Keep existing builds available. This plan does not call for publishing, replacing the installed app, or operating on the personal library.

## Acceptance checks

- Desktop focused tests via `test/runtests.sh`: `server_connector`, `annotationStorageMode`, `annotationStorageCoordinator`, `reader`, and `preferences_advanced`, followed by relevant annotation/data-sync coverage. New reconciliation cases belong in `annotationStorageCoordinatorTest.js` per repository instructions.
- Worker: `npm run test:pdf`, plus build/type checks required by the changed worker. Verify identity, precise-source deletion, appearances, digests, tombstones, and all-or-nothing writes.
- Connector: `env HEADLESS=true npm test`; run deterministic `publisherSupplementaryTranslatorTest.mjs` coverage and translator syntax checks for ACS, Nature, Cell, RSC, Atypon, and Wiley.
- SI: preference off/download/link-only; `downloadAssociatedFiles` on/off; old Desktop compatibility; Connector disconnect and Manifest V3 offscreen refresh. Verify metadata and main-PDF behavior remain intact and count actual files as well as descriptors. Science and Wiley full transfers were still pending in the SI handoff because isolated metadata requests were blocked; use positive controls and a normal authenticated browser for final transfer validation.
- Combined lifecycle: download a main PDF and multiple SI PDFs, then create/edit/delete annotations in each of Standard, PDF-only, and Dual. Reopen, run all six mode transitions, and verify matching identities without double rendering. Cover PDF-first crash recovery, independent file/data-sync changes, conflicts and cancellation, stale copies, identity rotation, deletion non-resurrection, and two readers.
- Preference migration: fresh profiles remain Standard; existing legacy explicit false maps to Standard; legacy true or old default maps to PDF-only. Select Dual explicitly for Dual acceptance tests. SI default changes must respect explicit user overrides.
- Optional linked-folder variant: include provider/manager tests, missing roots, identical filenames, interrupted copy/retry, open-reader deferral, all article PDF children, and annotation preservation through stored-to-linked replacement. Review uncommitted manager fixes before claiming the current working-copy behavior is included.
- Use a disposable profile/library for integration tests. A production build is accepted only after inspecting the staged app's actual translator/worker content and completing the combined download-to-annotation round trip.

## Deliverable decision

The smallest complete combined release is **annotation Desktop `52ac324e2b` + Desktop SI `522858cc8` + translators `70e15ee7` + worker `7310261`, paired with Connector `4c0baf1`**. Source merging is straightforward; reproducible submodule assembly and end-to-end PDF lifecycle verification are the main remaining work.
