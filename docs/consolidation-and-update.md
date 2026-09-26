# Consolidation and Upstream Update

This records the September 2026 integration. Exact package commits, checksums,
fresh-clone results and retirement records are kept in the external artifact and
recovery directories named in `integration/source-manifest.json`.

## Preserved source graph

Desktop remains at the root. Connector, document-worker and translators are owned
subtrees with non-squashed merges; their original commit IDs remain ancestors.
There is no rebase, squash or force-push. Unmodified dependencies remain pinned
official submodules, registered in the root `.gitmodules`.

Today's six dirty Connector source/test files were reviewed and committed as
`4c8c9f9c3f1efb4d268ee158ecf85f0aa9c40402` before import. Existing project guidance
was preserved before replacing it with one current root `AGENTS.md` and a build
README. Specialized publisher evidence remains in `TranslatorAgents.md`.

Named `preservation/legacy/*` tags retain local branch tips and source-only dirty
snapshots. Older prototype hashes were compared with the recorded integration
inputs. Unmatched old handoff/lockfile changes were preserved, not automatically
reintroduced. The full archive includes ignored assets, Git directories, LFS
content, untracked files and unrelated files found inside old folders. Git bundles
alone do not contain all of that material.

The verified recovery archive is `original-files.tar`, SHA-256
`c6af256d7617efe385c419c8219defb28d7556cd79540fa9019cdec09d49e614`.
Its restored copy matched 292,319 regular files and 13,218 symlinks (12,985,201,739
file bytes) in the original verification. See `recovery-verification.json` and
`preservation-refs.json` outside the source checkout for the full inventory.

## Frozen upstream inputs

| Component | Frozen revision |
| --- | --- |
| Desktop main | `8c3b967bf9f7ed2a44bdf8c6a70b7c65489b8cfb` |
| Connector main | `876e41ad15139077f2e07b2f71a0fa94742e0b4a` |
| Worker selected by Desktop | `8fb70af4000873561c82b2f4eb88be190efb9979` |
| Official translators main | `c83003773b65359e41466e1d419b2d1df5512af7` |

Connector's former custom Desktop dependency differed only in translator
configuration. It is replaced with compatible official pin
`01ebeb183439bbd79797bbcd4a41e99aad099ab8`; custom translator fixtures/loading use
the owned root translator tree. This avoids an active dependency on the superseded
component forks without erasing their historical provenance.

## Conflict decisions

| Area | Resolution |
| --- | --- |
| Desktop defaults | Retained the three-mode annotation preference and accepted upstream popup-position defaults. |
| Desktop worker/translator gitlinks | Kept owned directories, then merged the corresponding upstream component histories separately. No blanket `ours` merge. |
| Connector ping | Retained versioned translator/download-policy fields and response validation; adopted upstream passive-call options, tab context and Safari localhost-permission handling. |
| Connector disconnect/errors | Retained policy clearing and adopted upstream non-Zotero endpoint/error detection. |
| Connector save activation | Retained translator preference loading before save; adopted upstream online/permission/first-save flow. |
| Connector item saver tests | Retained both custom policy tests and upstream automatic-tag tests. |
| SingleFile | Accepted upstream bundled SingleFile implementation and removed obsolete dependency registration. |
| ACS translator deletion | Retained custom ACS translator ID and priority 100 for Figshare SI and modern/legacy ACS layouts; retained upstream Silverchair at priority 280. Removed ACS from the deletion list and advanced its list version to 76. |

Cleanly merged intersections were also reviewed: reader native notifications,
transaction callbacks, attachment download paths, settings, worker interfaces,
and build tooling. The three annotation modes, PDF-first Dual persistence, draft
protection, conflict/retry logic, linked collection hierarchy, SI preferences,
download controls and Config Editor remain in place. No unrelated custom schema
version was introduced.

## Required compatibility repairs

- Owned worker builds use a content-based cache key, including tracked/untracked
  inputs and initialized dependency revisions. They no longer identify the worker
  by the enclosing Desktop commit or rely on a private prebuilt cache. Tests cover
  unrelated root commits, dirty/new files, dependency changes and ignored outputs.
- Root dependency registration is checked against every gitlink and manifest pin.
- Generated Fluent and Config Editor catalogs were refreshed from merged source.
- The locked reader-open path now awaits `_openPromise`, not the success-only
  `_initPromise`. A failed/closed startup previously could leave the attachment
  reservation and serialized UI open queue pending. Failure closes the incomplete
  reader, releases the reservation, and allows retry. The lock is retained through
  successful startup, preserving migration serialization.
- Reader-opening UI fixtures wait for startup completion before closing tabs.
  WebDAV UI fixtures wait for the upstream asynchronous credential load before
  clicking Verify. These are readiness checks, not disabled assertions.

## Validation boundaries

The consolidated pre-update baseline passed 224 focused Desktop tests, 126
Connector browser tests (13 pending), 188 worker PDF tests, typechecking and 13
publisher fixture files. The baseline is tagged, not reconstructed by rewriting
history.

The updated build passed 293 focused Desktop tests including database cases,
138 Connector browser tests (13 pending), 286 worker PDF tests, worker typechecking,
DOM/Node/JSContext checks and its browser protocol test, 13 publisher fixture files,
and worker cache/source-graph checks. The production minified Connector also passed
a disposable-browser startup and download-policy smoke check.

The first broad Desktop run passed 3192/3223 checks; these totals include failing
hooks. Isolation identified reader-startup integration trouble, which was repaired,
plus UI focus/order and asynchronous WebDAV fixture failures also observed on an
untouched upstream control. The subsequent full run passed 3203/3226 checks, with
23 failures including hooks: debug startup, item-pane updates, retraction UI
state, and a sync retry timing assertion. Its result is recorded in
`final-desktop-all.log` and the external validation summary, alongside isolated
reruns. Do not describe either full run as fully passing or infer product failure solely from a cascading UI
test. Conversely, focused passing results do not establish a green full-suite run.

Package commands do not install anything. Production Desktop smoke tests use a
new profile/library and randomly assigned local API port, not a personal profile.
Connector smoke/browser tests use disposable Chrome profiles. macOS signing is
ad-hoc, verified with `--deep --strict`, and is not Apple notarization.

Live publisher authentication/download availability, Box peer propagation,
Dropbox/Google Drive, and two-Mac acceptance remain separate from fixtures.
No second Mac is available in the recorded environment, and Dropbox/Google Drive
are not configured. The installed application, personal library and normal Chrome
configuration are outside this effort's mutation scope.

## Recovery and retirement

Do not retire an original until archive restoration and fresh GitHub clone/build
verification have passed. Check for active processes and chats using each checkout.
Use worktree-aware removal for linked worktrees; retain unrelated files. Keep
recovery bundles, full archives and packages outside maintained source. Archive,
rather than delete, superseded GitHub component forks after current builds no
longer depend on them. Preserve existing published branches.

To recover source without depending on an old checkout, clone its standalone
bundle or create a branch from its named preservation tag. Extract the full file
archive into a separate recovery location for ignored/untracked/LFS material.
Archived linked-worktree `.git` pointer files reference their original locations;
do not treat them as independent clones. Restore the original parent/worktree
layout together, or use the standalone bundles and copy the preserved files.
