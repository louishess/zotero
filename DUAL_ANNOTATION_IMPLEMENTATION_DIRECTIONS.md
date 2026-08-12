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

## Verification expectations

Run the narrowest relevant tests while developing. Before handoff, report exact
commands and results. Final integration must cover all three storage invariants,
all six transitions, identity rotation, deletion non-resurrection, independent
Box/Zotero changes, conflicts, two readers, and external file replacement.
