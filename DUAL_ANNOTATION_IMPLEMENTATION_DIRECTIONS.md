# Dual annotation storage implementation directions

## Required reading

Read this file and `DUAL_ANNOTATION_STORAGE_PLAN.md` completely before editing.
The plan defines product behavior. This document fixes implementation boundaries
and cross-branch interfaces.

## Non-negotiable product decisions

- Keep three modes: `standard`, `pdf-only`, and `pdf-and-zotero`.
- Keep the PDF authoritative for dual-mode crash recovery.
- Keep bidirectional reconciliation because Zotero data sync and Box/file sync
  can independently deliver changes.
- Preserve stock Zotero behavior for unsupported sessions.
- Preserve unrelated and unsupported PDF annotations.
- Do not reuse a Zotero item key after its native annotation item is erased.
- Use tombstones only for user deletion, never for removal of one representation
  during a mode conversion.
- Use Zotero relative linked-file paths for mounted cloud folders; do not add a
  Box API, OAuth flow, or cloud-specific file database.
- Keep linked-folder migration limited to stored PDFs under personal-library
  journal articles. All PDF children of one article share one citation folder.
- Never erase a stored attachment until its cloud copy and replacement Zotero
  link have been verified.
- Treat provider-synchronized folders as byte transports. Zotero data sync
  remains responsible for attachment metadata and relative paths.

## Migration rule

Increase `prefVersion`. Fresh profiles have no previous preference version, skip
migrations, and receive the default `reader.annotations.storageMode=standard`.
For an existing profile being upgraded:

1. Explicit legacy `reader.annotations.saveToFile=false` maps to `standard`.
2. Explicit legacy `true` maps to `pdf-only`.
3. No explicit legacy value maps to `pdf-only`, because the shipped branch
   default was `true` and actual users normally have no user value.
4. Validate the new string, then clear the legacy user value if present.

Tests must cover fresh, explicit-false, explicit-true, and old-default cases.

## Sync-safe identity generations

Within Standard or Dual, the Zotero item key is the embedded PDF ID. Within
PDF-only, the embedded ID remains stable across ordinary edits.

When Standard or Dual changes to PDF-only, generate a fresh key for every
mirrored annotation, write and verify those new IDs in the PDF, and only then
erase the old native items. This means the old keys can safely enter Zotero's
sync delete log and will never be recreated. PDF-only to Standard or Dual may
create native items with the current PDF-only IDs. Representation removal must
not emit tombstones.

## Shared interfaces

- `AnnotationStorageMode`: `standard | pdf-only | pdf-and-zotero`
- Central mode/capability helpers must distinguish configured mode from effective
  mode for the current attachment.
- `PDFWorker.readAnnotations()` returns annotations, precise sources, current
  digests, embedded base digests, tombstones, file token, and file revision.
- `PDFWorker.applyAnnotationChanges()` accepts upserts, deletions, tombstone
  changes, exact duplicate removals, and optional identity replacements.
- Coordinator API:
  - `reconcile(itemID, reason)`
  - `applyChanges(itemID, changes, expectedState)`
  - `resolveConflicts(itemID, resolutions)`
- New reconciliation tests belong in
  `test/tests/annotationStorageCoordinatorTest.js`.
- `LinkedFolderProviders` profiles expose `id`, `label`, `detect(path)`,
  `validateRoot(path)`, `availabilityHint`, and an optional `moveToTrash(path)`.
- `LinkedFolderAttachmentManager` exposes `init()`, `queueLibraryMigration()`,
  `queueAttachment()`, `getOrCreateArticleFolder()`, `getMigrationStatus()`,
  `pause()`, `resume()`, `retryFailed()`, and `prepareManagedFileDeletion()`.
- The download-settings branch exposes `AutomaticAttachmentDownloads` with
  `classify()`, `isTypeEnabled()`, `shouldDownload()`, and
  `shouldDownloadItem()`. Cloud code must tolerate this module being absent.

If an interface must change, stop editing consumers, document the proposed
change in the agent report, and notify the coordinating agent.

## Work boundaries

- Mode/migration owner: preferences defaults, preference migration, central mode
  helpers, and focused migration tests.
- Worker owner: `document-worker` annotation read/write/apply implementation and
  worker tests. Do not edit Desktop reader or preferences code.
- Coordinator owner: new Desktop coordinator module and its dedicated tests. Do
  not edit preference UI or document-worker internals.
- Integration owner: reader wiring, conflict UI, notifications, and preference
  UI after the shared interfaces settle.
- Linked-folder provider owner: provider registry, root validation/detection,
  and provider-focused tests. Do not edit download policy or its preferences.
- Linked-folder integration owner: migration state machine, stored-to-linked
  conversion, notifier/startup queue, citation folders, deletion/orphans, UI,
  and integration tests on `implement/dual-annotation-storage`.
- Automatic-download owner: work only in the separate
  `feature/automatic-attachment-downloads` worktree and branch. Own the policy,
  seven device-local preferences, translator/storage hooks, Sync UI, and focused
  tests. Do not edit linked-folder modules. Commit ownership is granted for this
  branch only; push it and open a PR but do not merge it.

## Linked-folder behavior

- Use `baseAttachmentPath` as the device-local root and enable relative paths.
- Provider profiles for Box Drive, Dropbox, Google Drive, and a generic local
  folder share one filesystem implementation. Box Drive is the tested default.
- Generate a stable, sanitized, maximum-100-code-point folder name from the
  plain-text American Chemical Society bibliography entry. Resolve collisions
  with ` (2)`, ` (3)`, and so on; never adopt an unknown matching folder.
- Discover new eligible stored PDFs through startup scanning and item/file
  notifications so stock attachment creation paths remain intact.
- Persist resumable migration jobs in local `settings` rows under
  `linkedFolderAttachmentManager`. Copy to a deterministic temporary name,
  verify size and SHA-256, atomically rename, create a fresh linked attachment,
  transfer children/relations/full-text state, verify the resolved link, and
  only then erase the old stored attachment.
- Defer open readers and unavailable roots. Keep one migration-owner client for
  v1; retain both sides and report a conflict if two clients race.
- Zotero Trash does not move cloud files. Confirm before permanent interactive
  deletion; noninteractive deletions retain bytes as reviewable orphans.

## Automatic-download behavior

- Device-local, default-enabled controls cover PDF, DOCX, MD, XLSX, MP3, MP4,
  and WEBM. Unknown file types keep stock behavior.
- Specific recognized MIME types take precedence; generic or absent MIME types
  fall back to the final filename or URL extension.
- Filter automatic translator/OA acquisition and ordinary background storage
  downloads. Explicit Find Available File/PDF, Open, Download, and forced file
  recovery always bypass exclusions. Existing files and uploads are untouched.

## Verification expectations

Run the narrowest relevant tests while developing. Before handoff, report exact
commands and results. Final integration must cover all three storage invariants,
all six transitions, identity rotation, deletion non-resurrection, independent
Box/Zotero changes, conflicts, two readers, and external file replacement.
