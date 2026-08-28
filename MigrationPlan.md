# Linked Cloud Attachments for Zotero: Plugin Migration Plan

## Document control

| Field | Value |
| --- | --- |
| Target plugin | **Linked Cloud Attachments for Zotero** |
| Plugin ID | `linked-cloud-attachments@louishess.github.io` |
| Future repository | `louishess/zotero-linked-cloud-attachments` |
| Local sibling directory | `ZoteroLinkedCloudAttachments` |
| Source baseline | Annotation commit `e8bd987d02` |
| Zotero compatibility | `strict_min_version: 10.0`; `strict_max_version: 10.0.*` |
| License | AGPL-3.0-or-later |
| Scope | Linked-cloud attachment migration only |

## 1. Purpose and release boundary

This plan migrates the linked-cloud attachment subsystem out of the custom Annotation build and into a public-ready, bootstrapped Zotero 10 plugin. The plugin will move eligible stored PDF attachments into a user-selected cloud-synchronized folder, replace them with Zotero relative linked-file attachments, preserve Zotero metadata and native child data, and recover safely from interruption.

The migration is intended to improve installation, update resiliency, and use on stock Zotero. It must not require a custom Zotero executable, modify Zotero source files, patch core functions, or write directly to Zotero's main database tables.

The following are explicitly outside this plugin's implementation scope:

- The dual-annotation storage engine and its preference UI.
- Implementation of an automatic attachment-download policy.
- Cloud-provider APIs, OAuth, or direct upload/download clients. Box Drive, Dropbox, Google Drive, and generic providers are local synchronized folders from the plugin's perspective.
- Support for linked attachments in group libraries, Zotero mobile, or the Zotero web library.
- Migration of non-PDF files, standalone attachments, or files without a journal-article parent in the first public release.

The plugin may integrate with dual annotations and automatic downloads only through optional, feature-detected capabilities. Their absence must not prevent the plugin from loading, displaying status, or managing already-completed migrations.

## 2. Official Zotero constraints

Implementation and review must use the current official material as the authority:

- [Zotero Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers), for the bootstrapped-plugin model retained by Zotero 10
- [Make It Red official sample plugin](https://github.com/zotero/make-it-red)
- [Plugins for Zotero and installation guidance](https://www.zotero.org/support/plugins)
- [Linked-files guidance](https://www.zotero.org/support/attaching_files#linked_files)
- [Alternative syncing solutions](https://www.zotero.org/support/sync#alternative_syncing_solutions)

These sources lead to the following non-negotiable rules.

### 2.1 Packaging and lifecycle

- Use a plain bootstrapped JavaScript plugin based on the official Make It Red structure. Do not adopt a third-party plugin framework.
- Ship `manifest.json`, `bootstrap.js`, root-level `prefs.js`, Fluent localization files, and all runtime resources inside the XPI.
- Register the preference pane with `Zotero.PreferencePanes.register()`. Do not inject controls into Zotero's stock Files and Folders pane.
- Use a complete lifecycle: `startup()` initializes storage and registers observers/UI; `shutdown()` cancels or checkpoints jobs and removes observers, notifier registrations, timers, windows, menus, preference panes, Fluent resources, and database handles.
- Treat application shutdown as a normal lifecycle path. Every durable job phase must be restartable after Zotero exits between any two statements.
- Use namespaced JavaScript globals, preferences, DOM IDs, CSS selectors, Fluent IDs, filenames, observer IDs, menu IDs, and database paths. The preference namespace is `extensions.zoteroLinkedCloudAttachments.*`.
- Never monkey-patch `ZoteroPane`, attachment functions, item erasure, reader functions, or any other Zotero core method.

### 2.2 Compatibility and updates

- The initial `manifest.json` must declare `strict_min_version` as `10.0` and `strict_max_version` as `10.0.*`.
- Do not increase `strict_max_version` until the complete compatibility and failure-hardening suite passes on that Zotero release. A manifest-only update is permissible only after that validation.
- Publish signed-off XPI artifacts through GitHub Releases in `louishess/zotero-linked-cloud-attachments`.
- Publish a GitHub-hosted `updates.json` containing the release URL, version bounds, and SHA-256 hash for every XPI. Build automation must calculate the hash from the final artifact and verify it before release.
- Document manual installation through Zotero's Add-ons Manager and the risks of installing third-party plugins.
- Record every Zotero internal or non-contractual API in the compatibility adapter inventory and test it before each release.

### 2.3 Security and linked-file warnings

The README, first-run page, and preference pane must state plainly that:

- Zotero plugins execute inside the desktop application and therefore have full access to the user's filesystem and Zotero data. Users should install only releases they trust.
- Linked files are a desktop, personal-library feature. They are not available in group libraries, Zotero mobile, or the Zotero web library.
- Zotero syncs linked-attachment metadata and relative paths, not the linked bytes. A separate desktop cloud-sync client must make the same base folder available on every computer.
- The user must configure Zotero's existing Linked Attachment Base Directory consistently on each desktop. The plugin cannot make incompatible absolute paths portable.
- Simultaneous edits, selective-sync placeholders, offline provider roots, and cloud conflict copies remain cloud-provider concerns. The plugin must detect and report unsafe local state rather than assume synchronization succeeded.

## 3. Safety invariants

These invariants override convenience, performance, and UI behavior:

1. A stored source attachment is erased only after the final cloud file, SHA-256 and size, relative linked item, resolvable relative path, transferred child data, and current source identity are verified in the same resumed job.
2. The source is copied to a uniquely named temporary file under the validated target folder, hashed, and atomically renamed. It is never moved directly from Zotero storage.
3. A destination path must remain canonically contained by both the configured provider root and Zotero's linked-attachment base directory. Symlink traversal, `..`, normalization changes, and case-folding collisions must fail closed.
4. The plugin never adopts an unknown existing file solely because its name or bytes match. Only plugin-owned state and a matching ownership record can authorize resumption.
5. A job revalidates source identity, destination identity, target containment, ownership, and reader state immediately before every destructive or identity-changing operation.
6. Missing, unwritable, offline, placeholder-only, changed, or ambiguously owned files are retained and reported. They are not deleted or overwritten.
7. At most one attachment for a parent article may cross a mutation boundary at a time. Primary and supplementary PDFs share one stable article folder but keep distinct attachment items and filenames.
8. Claiming migration ownership is explicit. Ownership records never expire automatically and are never silently stolen by another Zotero client.
9. Plugin disable, uninstall, or application shutdown leaves migrated Zotero items and cloud files intact. Uninstall is not a rollback operation.
10. No new writes are made to Zotero's main database outside supported Zotero item, search, notifier, preference, and transaction APIs.

## 4. Feature-by-feature viability audit

Classification meanings:

- **Directly portable**: logic can move into plugin-owned modules with no material behavior change.
- **Compatibility adapter**: viable on Zotero 10, but it touches an internal or version-sensitive API and must be feature-detected, centrally isolated, tested, and fail closed.
- **Redesigned**: the core-build approach is inappropriate for a public plugin and must be replaced with an official extension point or safer workflow.

| Existing or required capability | Classification | Plugin migration decision and acceptance condition |
| --- | --- | --- |
| Provider registry | **Directly portable** | Move profile metadata and validation hooks into `ProviderRegistry`; providers cannot reach Zotero item state directly. |
| Box Drive, Dropbox, Google Drive, and generic local-folder profiles | **Directly portable** | Treat each as a local filesystem profile. Provider detection is advisory and generic selection always remains available. |
| Provider/root detection | **Directly portable** | Detect known folder conventions without silently selecting or claiming a root. User confirmation is required. |
| Root validation and write probes | **Directly portable** | Canonicalize the root, create and remove a unique probe, check rename semantics, and retain an actionable failure reason. |
| Zotero data-directory rejection | **Directly portable** | Reject the data directory itself and every descendant after canonical-path and symlink resolution. |
| Path sanitization and length limits | **Directly portable** | Preserve platform-invalid-character handling and deterministic fallback names; cap folder components at 100 Unicode code points. |
| ACS Quick Copy article-folder naming and fallback naming | **Directly portable** | Port deterministic citation-derived naming, sanitization, and fallback logic. A naming change after migration must not relocate an existing managed folder automatically. |
| One article folder for primary and SI PDFs | **Directly portable** | Serialize by parent key and reuse a persisted `folders` row. Each source gets a distinct filename and linked attachment. |
| Collision handling | **Directly portable** | Reserve paths transactionally, suffix deterministically, and never replace or adopt an unowned path. |
| SHA-256 and size verification | **Directly portable** | Stream hashes for source, temporary copy, final target, and any orphan considered for Trash. |
| Atomic temporary copy and rename | **Directly portable** | Copy in the destination directory, flush/close, verify, then rename without replacement. Preserve the stored source throughout. |
| Resumable durable jobs | **Directly portable** | Persist each completed phase and enough identity data to revalidate safely. Never infer progress from filesystem presence alone. |
| Per-parent serialization | **Directly portable** | Use an in-memory keyed queue backed by durable job leases/ownership. Startup reconstructs, rather than trusts, in-memory state. |
| Pause, resume, retry, and status reporting | **Directly portable** | Pause only at declared safe boundaries; expose reason codes, next action, and last verified phase. |
| Eligibility rules | **Directly portable** | Limit v1 to non-deleted stored PDF children of journal articles in the personal user library. Exclude group, publications, feed, standalone, non-PDF, linked, embedded-image, and already-managed attachments. |
| Startup discovery | **Redesigned** | Use `Zotero.Search` and item APIs. Do not scan attachment tables with raw SQL. Paginate or batch to avoid blocking startup. |
| New-item/file discovery | **Redesigned** | Register `Zotero.Notifier` for relevant item events, debounce by item key, reload current item state, and run eligibility checks. Notifications are hints, not authoritative state. |
| Linked Attachment Base Directory | **Redesigned** | Read and display Zotero's current relative-linked-file configuration. Direct users to Zotero's stock Files and Folders settings to change it; do not replace or shadow the setting. Disable migration until the provider root and base directory relationship is safe. |
| Stored-file download for an eligible missing source | **Compatibility adapter** | Probe the Zotero 10 download API (currently expected through `Zotero.Sync.Runner.downloadFile`). If unavailable or unsuccessful, persist `waiting-source`; never depend on an unimplemented downloads branch. |
| Open-reader detection | **Compatibility adapter** | Centralize reader lookup (including any use of `Zotero.Reader._readers`). Return open, closed, or unknown; unknown is unsafe and persists `waiting-reader`. |
| Relative linked-item creation | **Compatibility adapter** | Use Zotero attachment/item APIs and a Zotero-managed transaction. Probe signatures and verify the created item's library, parent, link mode, path, MIME type, and resolvability. |
| Moving native annotations and other children | **Compatibility adapter** | Prefer `Zotero.Items.moveChildItems()` and verify every original child now references the replacement. Missing support blocks destructive completion. |
| Copying relations | **Compatibility adapter** | Copy or retarget required attachment relations through item APIs, then reload and compare. Do not write relation tables directly. |
| Transferring full-text state | **Compatibility adapter** | Use feature-detected Zotero full-text APIs. The gate is either verified state transfer or a durable, verified reindex request; silent loss is prohibited. |
| Annotation coordinator cleanup | **Compatibility adapter** | Optional capability only. If `AnnotationStorageCoordinator.clearLocalState` or an equivalent exists, invoke it after native child transfer and before source erasure. Stock Zotero annotations move through `Zotero.Items.moveChildItems()` and cannot depend on this coordinator. |
| Automatic-download policy | **Compatibility adapter** | Optional capability check only. The plugin may request an available download, but cannot require or implement the uncommitted downloads branch. Persist a user-actionable wait state when no supported download path exists. |
| Existing settings stored in Zotero's `settings` table | **Redesigned** | Perform one idempotent, read-only legacy import into plugin-owned storage. Record source keys and import version. Never update or delete legacy rows. |
| Existing custom preferences | **Redesigned** | Import recognized values once into namespaced plugin preferences, show the proposed mapping, and require confirmation for roots or ownership. Leave old preferences untouched. |
| Custom-build preference UI | **Redesigned** | Build an official accessible pane registered by the plugin. Do not patch Zotero preference documents or stock panes. |
| Permanent-deletion interception through `ZoteroPane` patches | **Redesigned** | Register an official `Zotero.MenuManager` context command for explicit permanent deletion of managed items. For stock Empty Trash and other deletion paths, use notifier-created orphan records and a preference-pane review workflow. |
| Deleting cloud bytes | **Redesigned** | Only the explicit managed-deletion or reviewed-orphan workflow may remove bytes. On macOS use system Trash after immediate root, identity, and hash verification. On Windows and Linux retain the file and offer reveal/dismiss behavior until a separately reviewed Trash implementation exists. |
| Owner-file behavior | **Redesigned** | Retain durable owner records but add explicit claim/release controls. Never auto-expire, replace, or steal another client's ownership. Conflicts require user action. |
| Plugin disable and uninstall | **Redesigned** | Checkpoint and stop work, unregister all resources, and close storage. Do not erase linked items, cloud files, ownership files, or legacy/custom-build data. |

### 4.1 Audit conclusion

Every linked-cloud capability is viable as a Zotero 10 plugin when the version-sensitive attachment conversion operations are isolated and the core-patching behaviors are redesigned. The most consequential risk is not provider-specific filesystem logic; it is safe, supportable conversion of stored attachments while preserving children, relations, and full-text state. Therefore the compatibility adapter and source-erased-last acceptance gate are release blockers, not optional hardening.

## 5. Plugin architecture

### 5.1 Repository and package layout

Create the sibling repository at `ZoteroLinkedCloudAttachments` with this intended structure:

```text
ZoteroLinkedCloudAttachments/
├── manifest.json
├── bootstrap.js
├── prefs.js
├── LICENSE
├── README.md
├── updates.json
├── content/
│   ├── plugin.js
│   ├── providers.js
│   ├── migrationManager.js
│   ├── stateStore.js
│   ├── compatibilityAdapter.js
│   ├── orphanManager.js
│   ├── preferences.xhtml
│   ├── preferences.js
│   └── preferences.css
├── locale/
│   └── en-US/
│       └── zotero-linked-cloud-attachments.ftl
├── scripts/
│   ├── build.sh
│   └── make-updates.js
└── test/
    ├── unit/
    ├── integration/
    └── fixtures/
```

`bootstrap.js` owns one namespaced top-level plugin object, loads modules, waits for Zotero initialization, and makes initialization/shutdown idempotent. Runtime modules expose explicit interfaces rather than relying on patched globals.

### 5.2 Public internal interfaces

#### `ProviderRegistry`

```js
register(provider)
get(providerID)
getAll()
detect(path)
validateRoot(providerID, path, context)
```

Providers supply labels, local-root hints, normalization rules, and validation hooks. They cannot select a root, change Zotero preferences, start migration, or delete files.

#### `MigrationManager`

```js
init()
previewMigration(options)
queueAttachment(libraryID, attachmentKey, options)
queueLibraryMigration(libraryID, options)
getMigrationStatus(filter)
pause(reason)
resume()
retryFailed(jobID)
claimOwnership(scope, expectedOwner)
releaseOwnership(scope, expectedOwner)
shutdown(reason)
```

The manager owns eligibility, discovery, per-parent serialization, phase transitions, safe-boundary cancellation, and UI-neutral status events. It does not render UI or call private Zotero APIs directly.

#### `StateStore`

`StateStore` owns `state.sqlite` beneath a namespaced Zotero data-directory folder, proposed as `zotero-linked-cloud-attachments/state.sqlite`. It provides schema migration, transactions, compare-and-set phase transitions, job queries, managed-file identity, owner records, orphan records, and idempotent legacy import.

The versioned database contains:

| Table | Required purpose and key data |
| --- | --- |
| `meta` | Schema version, plugin version, legacy-import version/result, instance identity, and timestamps. |
| `jobs` | Job ID, library/source/parent keys, phase, identity snapshots, reserved target, attempts, wait/conflict reason, owner, timestamps, and serialized recovery data. |
| `folders` | Library and parent key, provider/root identity, stable relative folder, owner identity, and creation/verification timestamps. |
| `managed` | Current linked attachment key, original source key, parent key, relative path, provider/root identity, size, SHA-256, owner, and completion timestamp. |
| `orphans` | Former attachment identity, expected managed path/hash/size/root, deletion cause, verification state, user disposition, and timestamps. |

Schema upgrades run inside atomic transactions. An interrupted upgrade or import must be safe to repeat. No module other than `StateStore` issues SQL against this database. Direct SQL writes to `zotero.sqlite` are forbidden; legacy import is the sole planned direct read and must be isolated, versioned, and covered by read-only tests.

#### `CompatibilityAdapter`

The adapter probes Zotero 10 APIs once per startup and returns structured capability results rather than booleans. It contains all calls for:

- stored-file download;
- open-reader state;
- relative linked-attachment creation;
- child and native-annotation migration;
- relation copy/retarget;
- full-text transfer or reindex;
- optional dual-annotation coordinator cleanup; and
- optional automatic-download integration.

Every operation must distinguish `supported`, `unsupported`, `unsafe`, `temporarily-unavailable`, and `failed`. Unsupported or ambiguous behavior fails closed before source erasure. No adapter probe may mutate user data.

#### `OrphanManager`

```js
record(event)
verify(orphanID)
list(filter)
reveal(orphanID)
moveToTrash(orphanID)
dismiss(orphanID, reason)
```

The orphan manager responds to notifier evidence that a managed Zotero item disappeared outside the explicit plugin command. It never deletes during the notifier callback. Review rechecks canonical containment, root identity, current file hash/size, managed ownership, and absence of an active linked item immediately before any platform-supported Trash operation.

### 5.3 Durable job phases

Jobs use exactly these durable phases:

1. `queued` — eligible identity snapshot captured; no filesystem mutation.
2. `waiting-root` — provider root/base directory missing, offline, unwritable, or unsafe.
3. `waiting-source` — stored source missing or download unavailable/failed.
4. `waiting-reader` — reader is open or reader state cannot be proven safe.
5. `target-selected` — stable folder and unowned collision-free target reserved.
6. `copied-temp` — unique temporary copy closed on disk; source retained.
7. `copy-verified` — source/temp hash and size match, and final rename completed and verified.
8. `linked-item-created` — replacement item created and relative path reopened successfully.
9. `children-transferred` — children/annotations, relations, and full-text disposition verified.
10. `source-erased` — current source identity reverified and stored source item erased last.
11. `complete` — managed record and final audit written; temporary state removed.
12. `conflict` — resumption is unsafe without an explicit user decision.

Wait phases are resumable conditions, not failures. `conflict` requires preserved evidence and must never offer a destructive one-click retry. Each phase transition is committed only after its postcondition is verified. On startup, the manager validates the prior phase instead of assuming the persisted phase remains true.

### 5.4 Preference pane

The official pane must provide:

- Provider selection, detected-provider explanation, root picker, root validation, and write-probe result.
- Read-only display of Zotero's current Linked Attachment Base Directory, with a command that opens or identifies Zotero's stock Files and Folders settings.
- A dry-run preview grouped by eligible, excluded, waiting, conflicting, and already-managed attachments.
- Start, pause, resume, and targeted retry controls.
- Explicit owner claim and release controls with instance identity and conflict warnings.
- Aggregate and per-job progress, current safe phase, wait reason, recovery action, and exportable diagnostic details that omit paths by default.
- Orphan review with verify, reveal, macOS move-to-Trash, retain, and dismiss actions.
- A legacy-import preview and result; imported roots and ownership require confirmation.

All UI and Fluent IDs must be prefixed `zotero-linked-cloud-attachments-`. Controls must work by keyboard, have accessible names and status announcements, localize all visible text, tolerate external preference changes, and render a non-destructive unavailable state when the manager or an adapter capability is absent.

## 6. Legacy custom-build migration

On first compatible startup, the plugin performs a previewable, one-time import:

1. Detect recognized legacy preference names and linked-cloud `settings` records without changing them.
2. Normalize values into an import proposal and flag paths, owners, incomplete phases, or schemas that cannot be mapped safely.
3. Store an import fingerprint and version in plugin `meta` so retry after interruption is idempotent.
4. Copy accepted non-sensitive state into namespaced preferences and plugin tables in one plugin-database transaction.
5. Require user confirmation before activating a provider root, claiming an owner record, or resuming an incomplete legacy job.
6. Mark the import complete only after rereading and comparing plugin-owned data.

The importer must not erase legacy rows, clear legacy preferences, or assume the custom-build manager is inactive. If both managers are detected, migration is disabled until the custom-build linked-cloud feature is turned off. Imported completed mappings must be reverified from Zotero items and filesystem identity before entering `managed`.

## 7. Project checkpoints

Each checkpoint is an independent assignment with one focused commit. The implementing model must not begin the next checkpoint until the current acceptance gate passes. If a gate cannot pass, the checkpoint remains open and its handoff records the blocker; scope must not be silently reduced.

Every handoff must include:

- commit hash and changed files;
- tests run, exact results, and omitted tests;
- assumptions and user-visible decisions;
- every compatibility-adapter method added or invoked;
- database schema or migration effects;
- shutdown/rollback behavior exercised; and
- unresolved risks, follow-up owners, and evidence for the acceptance gate.

### Checkpoint 1 — Baseline and extraction inventory

**Objective:** Freeze behavioral and safety invariants before separating code.

**Work:** Inventory committed linked-folder implementation, tests, preferences, localization, startup hooks, deletion patches, annotation/download touchpoints, and the current uncommitted safety changes in `linkedFolderAttachmentManager.js`, `zotero.json`, and `linkedFolderAttachmentManagerTest.js`. Map every behavior to `ProviderRegistry`, `MigrationManager`, `StateStore`, `CompatibilityAdapter`, `OrphanManager`, the preference pane, legacy import, or a documented redesign/non-goal. Capture test fixtures without editing the Annotation worktree.

**Deliverables:** Traceability matrix, extraction manifest, frozen safety invariants, private-API inventory, legacy-state schema notes, and a parity test list.

**Gate:** Every linked-folder behavior, including uncommitted safety work, maps to a plugin component, explicit adapter boundary, or approved redesign. No implementation begins with an unclassified core hook.

**Commit focus:** Inventory and baseline documentation only.

### Checkpoint 2 — Plugin scaffold

**Objective:** Establish the installable stock-Zotero lifecycle.

**Work:** Create `ZoteroLinkedCloudAttachments`, AGPL license, manifest bounds, bootstrap lifecycle, root `prefs.js`, Fluent resource, registered preference pane placeholder, build script, update-manifest generator, and unit/integration harness. Follow Make It Red without third-party frameworks.

**Deliverables:** Reproducible XPI and lifecycle smoke tests.

**Gate:** The XPI installs, enables, disables, restarts, and uninstalls cleanly on stock Zotero 10; shutdown leaves no observer, timer, pane, menu, Fluent resource, window object, or open handle.

**Commit focus:** Minimal plugin scaffold and lifecycle tests.

### Checkpoint 3 — State store and legacy import

**Objective:** Own durable state outside Zotero's main database.

**Work:** Implement versioned `meta`, `jobs`, `folders`, `managed`, and `orphans` tables; transactions; compare-and-set phase updates; schema upgrades; corruption handling; and the previewable one-time read-only legacy importer.

**Deliverables:** Schema documentation, migration fixtures, import preview/result API, and recovery tests.

**Gate:** Interrupted schema upgrades and imports are idempotent, plugin state remains consistent, and all legacy rows/preferences remain untouched. No test observes a write to Zotero's main database outside normal item APIs.

**Commit focus:** Plugin-owned persistence and read-only legacy import.

### Checkpoint 4 — Providers and root safety

**Objective:** Port provider-neutral filesystem safety.

**Work:** Implement Box Drive, Dropbox, Google Drive, and generic profiles; detection; root/base relationship checks; data-directory rejection; symlink/canonical containment; path sanitization; length bounds; collision reservations; write probes; and generic fallback.

**Deliverables:** Provider contract, platform fixtures, and filesystem adversarial tests.

**Gate:** No path inside the Zotero data directory or outside the selected base root can be accepted, including through symlinks, traversal, normalization, case differences, or rename races. An unowned collision is never overwritten or adopted.

**Commit focus:** Provider registry and root/path safety.

### Checkpoint 5 — Resumable file migration engine

**Objective:** Port the non-Zotero-specific state machine without destructive behavior.

**Work:** Implement durable phases, per-article serialization, target reservation, temporary copies, streaming SHA-256, atomic rename, source/destination snapshots, pause/resume/retry, conflict reporting, and shutdown checkpoints. Use fake attachment identities until conversion exists.

**Deliverables:** Engine API, crash injector, phase fixtures, and mutation-race tests.

**Gate:** No injected failure, pause, crash, or shutdown phase can erase, replace, or mutate the stored source. Restart from every durable phase either advances after revalidation or stops safely with an actionable wait/conflict.

**Commit focus:** Resumable copy engine and recovery tests.

### Checkpoint 6 — Zotero attachment conversion

**Objective:** Safely replace a stored PDF with its relative linked attachment.

**Work:** Implement adapter operations for linked-item creation, child/native-annotation transfer, relation copy, full-text transfer/reindex, optional annotation-coordinator cleanup, reopen verification, and source erasure last. Preserve attachment title, parent, content type, charset where relevant, tags/notes/relations, and stable primary/SI distinctions.

**Deliverables:** Adapter capability report, stock-Zotero integration tests, and conversion audit records.

**Gate:** Primary and multiple SI PDFs receive distinct linked attachments in one stable article folder; metadata, native annotations/children, relations, and full-text disposition are verified. A stored attachment cannot be erased until the final cloud bytes, linked item, relative path, all required child state, and current source identity pass the release invariant.

**Commit focus:** Version-isolated Zotero conversion pipeline.

### Checkpoint 7 — Discovery and ownership

**Objective:** Discover work through supported APIs and coordinate multiple desktops.

**Work:** Add batched startup searches, debounced `Zotero.Notifier` queues, current-state eligibility reloads, missing-source recovery, optional stored-file download, reader-open deferral, instance identity, owner files, and explicit claim/release workflows.

**Deliverables:** Discovery metrics, ownership protocol, two-client simulator, and wait-state tests.

**Gate:** Discovery uses no direct attachment-table scan. Two clients never silently adopt, overwrite, expire, or steal one another's paths or results. Unknown reader/download capability blocks only unsafe migration and yields an actionable status.

**Commit focus:** Supported discovery, wait recovery, and explicit ownership.

### Checkpoint 8 — Official preference pane

**Objective:** Make configuration and recovery usable without core UI changes.

**Work:** Implement provider/root controls, base-directory display and stock-settings direction, preview/start/pause/resume/retry, owner controls, progress/conflicts, diagnostics, legacy import, and orphan review. Register/unregister through the official preference-pane API.

**Deliverables:** Localized pane, accessibility checklist, UI integration tests, and screenshots for release documentation.

**Gate:** Keyboard navigation, focus order, ARIA names/status, Fluent fallback, external preference updates, resize behavior, manager-unavailable states, and adapter-unavailable states pass on stock Zotero 10. No stock preference DOM is patched.

**Commit focus:** Namespaced, accessible official UI.

### Checkpoint 9 — Deletion and orphan safety

**Objective:** Replace core deletion patches with explicit and recoverable workflows.

**Work:** Add an official context-menu command for explicit permanent deletion of managed items; record post-delete orphans for stock Empty Trash and other paths; implement review, reverify, reveal, retain, dismiss, and macOS Trash operations. Do not delete in notifier callbacks.

**Deliverables:** Deletion threat model, orphan lifecycle tests, platform behavior documentation, and recovery instructions.

**Gate:** Root, owner, identity, size, and SHA-256 are reverified immediately before Trash. Changed, missing, moved, ambiguous, or unrelated files are retained and reported. Windows and Linux never permanently delete cloud bytes. There are no `ZoteroPane` patches.

**Commit focus:** Official deletion command and non-destructive orphan management.

### Checkpoint 10 — Compatibility and failure hardening

**Objective:** Prove every version-sensitive boundary and lifecycle path.

**Work:** Run each adapter probe and operation on the oldest and latest supported Zotero 10 builds; inject unavailable APIs, changed signatures, rejected transactions, closed windows, offline roots, database errors, and shutdown at each phase. Audit all registrations and private API references.

**Deliverables:** Compatibility matrix, private-API ledger, failure-injection report, and clean-shutdown audit.

**Gate:** Zero monkey-patches, zero private API calls outside `CompatibilityAdapter`, zero unguarded adapter operations, and safe shutdown during every phase. A missing or ambiguous required API disables new migration with an actionable message while leaving status, export, and recovery available.

**Commit focus:** Capability guards and failure hardening.

### Checkpoint 11 — End-to-end cloud validation

**Objective:** Validate real desktop synchronization behavior within Zotero's documented limits.

**Work:** Exercise Box Drive, Dropbox, Google Drive, and generic synchronized folders on two desktops. Cover online/offline transitions, selective-sync placeholders, filename normalization, delayed synchronization, conflict copies, base-directory differences, ownership conflicts, and metadata sync ordering.

**Deliverables:** Provider test report, two-device runbook, supported-limitations table, and recovery outcomes.

**Gate:** Two-device Zotero metadata and relative-path synchronization works for supported personal-library PDFs without silent adoption or overwrite. Every provider limitation has an actionable UI/documentation outcome, and tests do not claim support for groups, mobile, or web.

**Commit focus:** End-to-end fixtures, documentation, and provider-specific corrections only.

### Checkpoint 12 — Public release and core cleanup

**Objective:** Release the plugin and remove duplicated linked-cloud core code only after parity.

**Work:** Produce the XPI, SHA-256 checksums, `updates.json`, GitHub Release, install/update instructions, privacy/security warning, linked-file limitations, recovery guide, changelog, source archive, and support template. Verify stock Zotero first. Then remove only linked-cloud core files, startup hooks, preferences UI, locale/style entries, and linked-cloud tests from the Annotation fork.

**Deliverables:** Reproducible release, signed-off acceptance report, cleanup diff, and rollback/reinstall instructions.

**Gate:** The published plugin works on stock Zotero 10 and on the Annotation build without duplicate managers. Release hashes and compatibility bounds verify. Annotation cleanup removes no dual-annotation engine or unrelated automatic-download work, and the plugin remains fully operable after the core cleanup.

**Commit focus:** One focused plugin release commit; the Annotation-tree cleanup is a separately reviewed repository commit recorded in the same handoff.

## 8. Test and acceptance matrix

The test harness must combine pure unit tests, fake-filesystem fault tests, stock-Zotero integration tests in disposable profiles, and manual provider/two-device validation. Every destructive-boundary test starts with recoverable fixtures and asserts both Zotero item state and filesystem state.

| Area | Required cases and assertions |
| --- | --- |
| Article layout | Primary plus multiple SI PDFs share exactly one persisted article folder, have distinct collision-safe names and linked attachment keys, and preserve parent/title/MIME metadata. |
| Eligibility exclusions | Reject group libraries, My Publications where unsupported, feeds, trash, standalone files, non-journal parents, non-PDFs, linked files, embedded images, missing parents, and already-managed attachments without filesystem mutation. |
| Roots | Cover missing, unwritable, offline, placeholder-only, data-directory-contained, symlink-escaping, wrong-base, case-colliding, Unicode-normalizing, and root-replaced paths. |
| Missing sources/downloads | Cover missing stored files, supported download success, download failure, optional API absence, an unimplemented automatic-download subsystem, and source mutation after download. |
| Reader state | Cover open, closed, reader closing/opening during a job, multiple windows, and unknown reader API. Unknown/open must defer before mutation. |
| Pause and shutdown | Inject pause, disable, uninstall, normal shutdown, and forced process termination before and after every durable phase and destructive boundary. |
| Mutation races | Change source or destination content, metadata, symlink target, root identity, permissions, and owner records between every pair of verification steps. |
| Duplicates/conflicts | Duplicate requested paths, attachment keys, parent folders, jobs, managed records, cloud conflict copies, and migration owners must converge or stop without adoption/overwrite. |
| Crash recovery | Restart from every durable phase with valid, missing, changed, and partially present artifacts; validate phase postconditions before advancing. |
| Zotero data | Preserve native annotations/children, relations, attachment metadata, and full-text state or verified reindex disposition. Test adapter absence and partial failure. |
| Legacy state | Import each supported custom-build schema, mixed/corrupt records, interrupted import, reinstall, repeated first run, both-managers-active, and declined confirmation. Legacy data must remain unchanged. |
| Deletion/orphans | Cover plugin explicit deletion, stock move to Trash/Empty Trash, permanent erasure outside plugin, notifier duplication/loss, missing or changed cloud files, hash mismatch, unrelated same-name files, macOS Trash failure, and Windows/Linux retain/reveal. |
| Lifecycle | Disable/uninstall with queued, waiting, copying, verified, conversion, source-erased, complete, conflict, and orphan-review work. Assert cleanup and durable recovery. |
| Compatibility | Run against Zotero 10.0 and the latest 10.0 release, verify `strict_min_version`/`strict_max_version`, simulate unsupported future versions, and audit all adapter probes. |
| Accessibility/localization | Keyboard-only operation, logical focus, ARIA names/live status, high zoom, localized labels/errors, en-US fallback, and teardown/re-registration. |
| Updates | Build deterministic XPI, calculate and compare SHA-256, validate `updates.json`, upgrade with active durable state, reject altered artifact, and preserve plugin database. |

### 8.1 Release acceptance rule

Release acceptance requires evidence that **no stored attachment is erased before its cloud bytes, linked item, relative path, child data, and current source identity have all been verified**. Relations and full-text must also be verified as transferred, retargeted, or durably scheduled for supported reconstruction according to the adapter contract. A single counterexample blocks release.

## 9. Model execution protocol

For each checkpoint, the assigned model must:

1. Read this plan, the previous checkpoint handoff, and all files it intends to modify.
2. Confirm the checkpoint's scope, baseline commit, dirty-tree state, and acceptance gate before editing.
3. Add or update tests in the same checkpoint as behavior.
4. Keep private Zotero access in `CompatibilityAdapter` and document every capability probe.
5. Run the narrow test set first, then the checkpoint's complete gate suite.
6. Inspect the final staged diff for unrelated, generated, submodule, credential, fixture-data, and custom-build changes.
7. Create exactly one focused commit after the gate passes.
8. Write the required handoff. Do not begin or partially implement the next checkpoint.

Recommended handoff template:

```markdown
## Checkpoint N handoff
- Baseline / commit:
- Changed files:
- Gate evidence:
- Tests passed:
- Tests omitted and reason:
- Compatibility-adapter APIs used:
- Schema or state changes:
- Shutdown/recovery paths exercised:
- Assumptions and user-visible decisions:
- Unresolved risks and owner:
- Ready for Checkpoint N+1: yes/no
```

## 10. Completion definition

Migration is complete only when:

- A public XPI installs on stock Zotero 10 without a custom build.
- Every linked-cloud feature in Section 4 is implemented through its assigned direct, adapter, or redesigned path.
- All twelve checkpoint gates and the complete acceptance matrix pass.
- The plugin uses supported registration points, contains no core monkey-patches, and performs no direct main-database writes outside normal Zotero item APIs.
- Disable, uninstall, interruption, offline storage, API incompatibility, and two-client conflicts preserve user data and provide recovery guidance.
- Public documentation accurately explains full-filesystem plugin trust, desktop cloud-client requirements, and Zotero linked-file limitations.
- Only after plugin parity is demonstrated, the Annotation fork's linked-cloud implementation is removed without removing the dual-annotation engine or unrelated automatic-download work.

This definition favors data preservation over automatic progress: an actionable stopped migration is acceptable; an ambiguous migration that proceeds destructively is not.
