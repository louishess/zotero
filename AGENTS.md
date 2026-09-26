# ZoteroMerge Maintenance Guide

This is the single authoritative project guide. The maintained checkout is
`/Users/louishess/Developer/ZoteroMerge`, GitHub repository
`louishess/zotero`, branch `ZoteroMerge`. Build paths must not contain spaces.
See README.md for commands and integration/source-manifest.json for provenance.

## Current authorization

The user authorized history-preserving consolidation, latest frozen upstream
integration, tested Desktop/Connector packages, recoverable retirement of redundant
copies, and an efficiency audit. Do not install either package, change Chrome
configuration, or touch the personal library/installed application.
Audit-driven optimizations require a separate decision. Only consolidation and
upstream compatibility repairs are authorized during this effort.

Desktop owns the root; Connector, document-worker and translators are owned source
with full imported histories. Unmodified dependencies remain pinned submodules.
Never squash, rebase, force-push, silently update dependencies, or discard work.
Preserve original commit IDs. Use focused commits for restructuring, upstream
merges, compatibility repairs, tests and documentation.

Recovery files are outside the checkout:
`/Users/louishess/Developer/ZoteroMerge-archive/2026-09-25`.
Build/test/package evidence is outside the checkout:
`/Users/louishess/Developer/ZoteroMerge-artifacts/2026-09-25`.
Original source states, ignored files and LFS objects are in the verified full-file
archive. Named `preservation/legacy/*` refs retain branch heads and source-only
working-file snapshots; these are recovery inputs, not active product branches.
Do not retire originals until GitHub clone/build and recovery gates pass.

## Product invariants

- Annotation modes: Standard, PDF-only, and PDF-and-Zotero (Dual). Fresh profiles
  default to Standard. Transitions must preserve annotations and warn where needed.
- Dual persistence is PDF-first, then the native mirror. Retain stable IDs,
  generations, tombstones, conflict handling and retry/restart recovery.
- Native mirror notifications must not overwrite unsaved reader drafts. Preserve
  two-reader behavior, failed drafts, explicit conflict/read-only states, and
  attachment locks during writes, reader opening, and replacement migrations.
- Preserve worker/coordinator public contracts and existing schema. Adapt to
  upstream APIs explicitly; add no unrelated schema changes.
- The SQLite database and its journal/WAL/settings stay outside cloud storage.
  Cloud folders hold linked attachment bytes and ownership/root markers.
- Collection hierarchy and renames use durable phases and restartable jobs.
  Preserve one organizer, metadata/relationship verification and interruption
  handling. Provider marker files are not distributed locks.
- Preserve seven device-local download controls and explicit-download overrides.
  Keep supplementary downloads enabled by default, with supplementaryAsLink false.
- Keep versioned Connector preference and download-policy contracts. Desktop
  overrides are runtime-only; disconnect restores Connector-local preferences.
- Keep PDF signature validation, failed-attachment progress completion, and the
  continued primary-PDF save/retry behavior when SI fails.
- Preserve Config Editor behavior and discoverable preference defaults.

## Validation and release

Run focused custom regressions, affected upstream suites and the broader Desktop
suite; typecheck and test the worker; run Connector browser tests and publisher
fixtures. Use disposable profiles/libraries and port 23124 (23129 only for isolated
live-transfer work), never the normal 23119 endpoint.

Test packaged source/assets and startup separately from development builds.
Record exact source revision, dependency/runtime inputs, checksums and ad-hoc
signature verification outside tracked source. A signature is not notarization.
Production Connector builds must not contain test endpoints or test-only resources.
Prove a fresh GitHub clone builds without old paths, unpublished objects or private
caches before making a validated candidate/default-branch claim.

Keep acceptance categories distinct: source review, deterministic fixtures,
automated package tests, byte transfer, and live/manual workflows. Historical live
checks do not establish acceptance of a new package. Two-Mac Box reconciliation,
Dropbox and Google Drive are not verified by local fixtures. No second Mac was
available in prior acceptance work. ACS end-to-end validation previously encountered
publisher verification; do not bypass it or infer a broken URL from isolated 403s.

Known findings and measured improvements belong in docs/efficiency-audit.md.
Do not apply a bulk npm audit fix or refactor safety checks as an incidental cleanup.

## Translator work

TranslatorAgents.md is the specialist SI guide, subordinate to this file for
project state and safety. Preserve main-PDF behavior while changing SI discovery.
Keep no-SI, discovery, authentication, byte-transfer and metadata failures separate.

Use translator-specific skills under translators/.agent/skills when developing a
translator. Inspect rendered pages or documented APIs; do not guess selectors from
minified/challenge responses. Do not bypass publisher access controls.
Prefer modern requestText/requestJSON/requestDocument helpers over deprecated
ZU.doGet/doPost/processDocuments. Scope changes to the actual platform and journal.

The retained custom ACS translator has priority 100; upstream Silverchair has
priority 280. Do not retire the ACS ID or put it in translators/deleted.txt while
its custom Figshare/modern-layout/legacy functionality remains active. If a
translator really is retired, append its ID and increment deleted.txt's version.
Keep SI-off, download, and link-only controls in fixture coverage.

## Build ownership

Root .gitmodules registers all direct gitlinks, including those under imported
directories. Nested component .gitmodules files retain their upstream path metadata.
Connector tests load the owned root translators, not its official Desktop asset
dependency's translator checkout.

The custom worker is always built from local owned source. Its cache key includes
tracked working bytes, non-ignored new source files, and dependency pins/HEADs.
Dirty upstream dependencies are rejected. Do not key vendored source by the
enclosing Desktop HEAD or fetch an unrelated stock worker bundle.

Historical project state and old path instructions remain available in Git history
and the external recovery archive. They do not supersede this guide.
