# Dual PDF and Zotero Annotation Storage — 6 Commits

## Summary

Replace the current Boolean preference with one annotation-storage mode:

- **Standard** — stock Zotero database annotations; PDF remains unchanged.
- **PDF-only Annotations** — current file-backed behavior; no annotation database items.
- **PDF and Zotero Annotations** — matching annotations in both stores using the same stable ID.

Fresh installations default to **Standard**. A preference-version migration runs
only for existing profiles: an explicit legacy `saveToFile=false` becomes
**Standard**, while `true` or the old default-without-a-user-value becomes
**PDF-only Annotations**. This preserves users who actually ran the existing
file-backed build, whose default was `true` and therefore usually left no user
preference to detect. The migration writes `storageMode` before removing the old
Boolean. Mode changes apply lazily when a PDF is next opened or reloaded.

Native annotation objects synchronize through Zotero data sync; the modified PDF synchronizes separately through Zotero file storage, Box, or another file service.

## Commit Series

### 1. `Reader: Introduce annotation storage modes`

- Add `reader.annotations.storageMode` with values `standard`, `pdf-only`, and `pdf-and-zotero`.
- Replace direct `saveToFile` checks with a central mode getter and separate PDF-writability capability check.
- Increment Zotero's preference migration version. For an existing profile,
  map explicit legacy `false` to `standard` and both explicit `true` and the
  former default `true` to `pdf-only`; fresh profiles skip migration and use the
  new `standard` default.
- Remove the old Boolean only after `storageMode` has been written and validated.
- Force unsupported sessions—groups, EPUBs, snapshots, read-only PDFs, and non-editable libraries—to Standard behavior.
- Add shared test helpers for selecting modes and asserting PDF/database state.

**Milestone:** All existing Standard and PDF-only tests pass without behavioral changes.

### 2. `document-worker: Add annotation reconciliation metadata`

- Generate a canonical digest from stable annotation fields: ID, type, geometry, text/comment, color, tags, page label, and author.
- Embed the last-common digest with Zotero-keyed PDF annotations.
- Add invisible PDF tombstones containing only annotation ID, prior digest, deletion revision, and time; retain them until explicitly purged.
- Return digests, tombstones, and precise source locators from `readAnnotations()`.
- Extend `applyAnnotationChanges()` to atomically upsert, delete, remove exact duplicates, and update tombstones.
- Deduplicate by stable Zotero ID or `/NM`; use structural fingerprints only for unambiguous external-annotation adoption.
- Preserve unrelated and unsupported PDF annotations.

**Milestone:** Document-worker tests prove round-trip identity, exact deduplication, tombstone persistence, and all-or-nothing failure.

### 3. `Annotations: Add the dual-storage coordinator`

- Add a per-attachment annotation coordinator responsible for all PDF and database mutations.
- In dual mode, write and verify the PDF first, then create or update a native non-external annotation item with the identical Zotero key.
- Treat the PDF as authoritative for crash recovery: if the database phase fails, repair the native mirror on the next reconciliation.
- Store compact last-common digests and pending repair state in Zotero’s local settings table; rebuild this state from the PDF when unavailable.
- Process database changes arriving through Zotero sync, the API, item deletion, or another reader—not only reader callbacks.
- Keep image/ink caches on demand rather than persist a second large image copy.

**Milestone:** Create, edit, tag, and delete each supported annotation with exactly one PDF annotation and one matching native item.

### 4. `Reader: Merge annotations and resolve conflicts`

- Perform stable-ID three-way reconciliation when opening, reloading, or receiving external changes:
  - Equal digests: deduplicate and mark synchronized.
  - Different annotation IDs: merge both sets.
  - Only one side changed from the common digest: propagate that change.
  - A matching tombstone: delete the stale copy.
  - Both sides changed, ambiguous deletion, or duplicate IDs with different content: report a conflict.
- Do not silently field-merge two conflicting versions of the same annotation.
- Add a conflict dialog listing each conflict with **Use PDF**, **Use Zotero**, or **Cancel**. No choice is preselected.
- Cancel opens the reader read-only; chosen resolutions write PDF first and then update the database.
- Retain the existing hard stop for genuine external file-token changes and require reload.
- Continue suppressing native rendering of embedded Zotero-keyed annotations so dual storage does not produce double highlights.
- Broadcast verified changes and conflict state to all open readers for the attachment.

**Milestone:** Automatic merges preserve independent annotations, while simultaneous edits to the same annotation never overwrite either version without confirmation.

### 5. `Preferences: Add the annotation storage dashboard`

- Add a **PDF Annotations** section to Advanced Settings.
- Present the three modes as one accessible segmented pill/radio group; selecting one automatically deselects the others.
- Use descriptive localized labels:
  - **Standard**
  - **PDF-only Annotations**
  - **PDF and Zotero Annotations**
- Add hover tooltips and accessible descriptions:
  - Standard: “Save annotations as Zotero items. The PDF remains unchanged.”
  - PDF-only: “Save annotations directly in writable personal-library PDFs. Zotero annotation items are not created.”
  - Dual: “Save matching copies in the PDF and as Zotero annotation items for searching and data sync.”
- Note that the setting applies only to writable PDFs in personal libraries.
- Mode changes affect newly opened or reloaded readers, not active editing sessions.
- Warn once before transitions that erase a representation.

Lazy, sync-safe transitions:

| From → To | Conversion |
|---|---|
| Standard → Dual | Embed native items and retain them |
| PDF-only → Dual | Create native items using the current embedded IDs |
| Dual → PDF-only | Rewrite verified PDF copies with fresh PDF-only IDs, then erase the old native items |
| Standard → PDF-only | Write and verify PDF copies with fresh PDF-only IDs, then erase the native items |
| PDF-only → Standard | Create native items, verify, then remove mirrored PDF annotations |
| Dual → Standard | Retain native items and remove mirrored PDF annotations |

External and unsupported annotations remain untouched until explicitly adopted.

Native item keys that have been erased must never be recreated. Zotero records
their deletion in `syncDeleteLog`, and the deletion may already have propagated
to another client. Every transition that leaves database-backed storage must
therefore rotate each mirrored annotation to a newly generated PDF-only ID
*before* erasing its native item. A later transition back to Standard or Dual
may safely use that current PDF-only ID as a new Zotero key. Representation-only
removal during a mode transition does not create an annotation tombstone;
tombstones are reserved for user deletions.

**Milestone:** UI tests verify exact-one selection, keyboard/ARIA behavior, localization, tooltips, legacy migration, and external preference updates.

### 6. `Tests: Cover the complete three-mode lifecycle`

- Test all six supported types across create, edit, tag, close, reopen, sync simulation, and deletion.
- Assert storage invariants:
  - Standard: database only.
  - PDF-only: PDF only.
  - Dual: one embedded annotation and one native item with the same key.
- Cover every lazy mode transition and interruption during each conversion phase.
- Verify that pre-existing profiles with no explicit legacy Boolean retain
  PDF-only behavior while fresh profiles default to Standard.
- Verify that transitions out of database-backed storage rotate embedded IDs,
  create ordinary Zotero sync deletions for the old keys, and never recreate a
  key found in the local delete log or a previously synchronized generation.
- Test PDF-first crash recovery, database repair, tombstone survival, stale Box copies, remote Zotero changes, and deleted-annotation non-resurrection.
- Test exact duplicates, ambiguous external annotations, unsupported annotations, page rotation/deletion, two readers, and real external-file replacement.
- Test each conflict-dialog resolution and cancellation/read-only recovery.
- Run document-worker PDF tests, annotation and sync tests, focused reader/preferences tests, and the production macOS build.

## Parallel Branches

After Commit 1 establishes the enum and interfaces:

- **Worker branch:** Commit 2, limited to document-worker identity, digests, and tombstones.
- **Coordinator branch:** Commit 3, using the agreed worker result types.
- **Preferences branch:** Commit 5’s dashboard, Fluent strings, styling, and isolated UI tests.
- **Integration branch:** Commit 4 after Worker and Coordinator merge.
- **Lifecycle branch:** Commit 6 after all functional branches merge.

Keep reconciliation tests in a dedicated file so parallel branches do not repeatedly modify `readerTest.js`.

## Internal Interfaces

- `AnnotationStorageMode`: `standard | pdf-only | pdf-and-zotero`
- `PDFWorker.readAnnotations()` additionally returns canonical digests, base digests, tombstones, and exact locators.
- `PDFWorker.applyAnnotationChanges()` accepts upserts, deletions, tombstones, and exact duplicate removals.
- New coordinator API:
  - `reconcile(itemID, reason)`
  - `applyChanges(itemID, changes, expectedState)`
  - `resolveConflicts(itemID, resolutions)`
- Reconciliation returns verified changes, updated file state, pending repairs, and structured conflicts.
- No Zotero annotation JSON or public web API format changes are introduced.

## Assumptions

- The PDF is the recovery authority in dual mode, while native annotation objects provide search, notes, APIs, and Zotero data sync.
- Unknown one-sided annotations without a trustworthy common digest produce a warning instead of automatic adoption or deletion.
- Tombstones contain no annotation text and remain invisible to ordinary PDF readers.
- Fresh installations default to Standard; all profiles that ran the legacy
  default-true file-backed build retain PDF-only behavior, even without an
  explicit Boolean user preference.
- A stable ID is preserved while an annotation remains in a storage generation.
  Leaving database-backed storage deliberately starts a fresh PDF-only identity
  generation so a synchronized Zotero deletion is never resurrected.
- Group libraries and unsupported attachment types retain stock Zotero behavior.
