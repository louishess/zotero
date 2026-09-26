# ZoteroMerge Efficiency Audit

Date: 2026-09-25 Pacific / 2026-09-26 UTC. Recommendations only: none of the
optimizations below were implemented during consolidation. The reader startup
repair and build-path/cache changes were required integration work, not audit
optimizations.

## Scope and evidence

Baseline: `preservation/validated-consolidated-baseline` (`fb151c37bd`). Updated
measurements: `1f74ba72fa`, with frozen upstream inputs in
[source-manifest.json](../integration/source-manifest.json). Both used the same
committed benchmark harness and fixtures. Baseline Gecko was 153.0; updated Gecko
was 153.3.0. Hardware: Apple M5 Pro, Mac17,9, 48 GiB RAM; macOS 27.0 (26A428).

Deep review covered the custom annotation coordinator/worker/reader integration,
linked-folder providers and migration manager, automatic-download policy,
Connector policy bridge and PDF-validation/progress changes, Config Editor, and
custom publisher translator intersections. The remaining source review was a
targeted scan of database callbacks, dependencies, build inputs, and packaging,
not an exhaustive security audit of all upstream code.

Raw evidence is outside tracked source:
`/Users/louishess/Developer/ZoteroMerge-artifacts/2026-09-25/`.
Use `baseline-benchmarks.json`, `baseline-benchmarks-verified.log`,
`updated-benchmarks.json`, `updated-benchmarks.log`,
`updated-boundary-diagnostic.json`, and `updated-{desktop,connector,worker}-audit.json`.
Earlier failed benchmark attempts are retained as diagnostics and are not data
for this report. Hash/poll figures below are medians of three warm-cache runs;
migrations have one run per size. There are no confidence intervals.

## Measurements

| Operation | Baseline ms | Updated ms |
| --- | ---: | ---: |
| SHA-256, 10 MiB | 18.93 | 20.41 |
| SHA-256, 100 MiB | 180.50 | 183.60 |
| SHA-256, 1 GiB | 1832.36 | 1866.48 |
| Migration, 10 MiB | 246.11 | 250.50 |
| Migration, 100 MiB | 2329.28 | 2364.36 |
| Migration, 1 GiB | 22461.70 | 22886.61 |
| Poll 100 PDFs, Standard | 3.69 | 3.49 |
| Poll 100 PDFs, Dual | 10.32 | 8.96 |
| Poll 1,000 PDFs, Standard | 33.27 | 34.30 |
| Poll 1,000 PDFs, Dual | 73.46 | 76.17 |
| Poll 10,000 PDFs, Standard | 320.32 | 330.12 |
| Poll 10,000 PDFs, Dual | 823.99 | 816.42 |

The small differences do not establish an upstream speedup or regression. The
dominant costs remain the same. Sizes use binary units: 10/100 MiB and 1 GiB,
not decimal MB/GB.

| Migration size | Longest transaction, baseline / updated ms | Maximum timer delay, baseline / updated ms | DB calls / transactions, both |
| --- | ---: | ---: | ---: |
| 10 MiB | 38.20 / 42.18 | 18.05 / 16.43 | 83 / 4 |
| 100 MiB | 479.56 / 480.03 | 180.47 / 192.01 | 83 / 4 |
| 1 GiB | 3800.93 / 3800.03 | 1929.28 / 1921.82 | 83 / 4 |

For updated 1 GiB hashing, maximum timer lateness was 1865.05 ms. For updated
10,000-PDF Dual polling, maximum lateness was 18.14 ms; the largest per-run p95
was 3.05 ms. Thus polling wall time is not equivalent to one continuous UI stall.
Each unchanged poll issued one observed database query and zero transactions.
A spy verified exactly N file-token checks for each N-PDF run. Source performs a
metadata stat for each token; kernel filesystem operations were not traced.

Resident memory during updated 1 GiB migration changed from 386,351,104 to
373,964,800 bytes. During the three 10,000-PDF Dual polls it changed from
1,213,530,112 to 1,128,464,384 bytes. Baseline equivalents were 384,008,192 to
372,752,384 and 1,188,790,272 to 1,183,449,088 bytes. These are process snapshots,
not allocation peaks or proof of a leak: fixture construction, item caches and GC
all contribute. The harness does not sample peak memory.

### Measurement limits

- Fixtures are disposable, local, and warm-cache. No cloud latency, placeholders,
  filesystem eviction, concurrent editors, or second-device behavior is simulated.
- Migrations use deterministic supporting `.bin` attachments to measure actual
  copy/hash/DB work without conflating it with PDF parsing. PDF-specific migration
  behavior is covered by functional tests, not these size timings.
- Poll fixtures are real linked copies of the test PDF, with unchanged reconciled
  state and no open readers. Initial reconciliation and changed-file storms are
  not measured by the polling table.
- Timer lateness uses a 10 ms timer; it is a responsiveness indicator, not a
  sampling profiler. Transaction timings include callback/cleanup work in the
  public transaction API, not only SQLite lock duration.
- DB counts instrument the three public query entry points without double-counting
  their immediate wrappers. They are not SQLite VM statement counts.
- The JSON `stats`/`copies` probes are scoped to the test global and do not capture
  production IOUtils calls in other compartments. Do not interpret their zeroes
  as zero filesystem I/O. Only token-check counts are independently verified.

## Ranked recommendations

### 1. P1: Canonicalize the linked-folder boundary

Status: **confirmed remaining safety issue**, not a new upstream regression.
`linkedFolderProviders.js:109-123` rejects a symlink at the selected leaf but uses
lexical containment for the data directory. A real directory reached through a
symlinked ancestor passes. The native diagnostic returned direct storage root
`valid:false, inside-data-directory`, but ancestor alias `valid:true, ok`.
`linkedFolderAttachmentManager.js:151` checks components only down to the selected
root, so it does not independently reject an alias above that root.

Benefit: enforce the existing prohibition on selecting Zotero's own library as a
managed cloud root. Effort: medium. Regression risk: high around File Provider
mounts, case/Unicode equivalence and paths that become unavailable.
Proposal: canonical identity checks at validation and mutation boundaries, with
revalidation before destructive transitions; retain the current ownership journal.
Acceptance: direct/ancestor symlink roots, data-dir aliases, parent-of-data-dir
aliases, Unicode/case variants, remounts, concurrent retargeting, and normal Box
roots. No fixture may reference a personal library. This audit did not attempt a
destructive migration through the bypass.

### 2. P2: Move whole-file hashing off the main thread

Status: **measured**. `linkedFolderAttachmentManager.js:322-343` is declared async
but calls synchronous `nsICryptoHash.updateFromStream`. A 1 GiB digest blocks for
about 1.9 seconds. Migration hashes the source, temporary copy, installed target,
and safety rechecks (`:1296-1355`, `:1917-1960`). Some repeats protect against real
replacement races and must not simply be removed.

Benefit: eliminate multi-second UI stalls during large-file migration and recovery.
Effort: medium for streaming worker hashing, high if also reducing reads.
Risk: high if content-identity or crash-recovery guarantees weaken.
Acceptance: identical digests, interrupted reads, file replacement during hashing,
short reads, inaccessible/cloud files, all migration restart tests, and timer
lateness below 50 ms on the same 1 GiB fixture. First move computation; optimize
duplicate reads only with an explicit identity/race model.

### 3. P2: Shorten migration transaction occupancy carefully

Status: **measured API duration; source-confirmed I/O inside transactions**.
The 1 GiB migration's longest transaction call is 3.80 seconds. Final identity
checks at `linkedFolderAttachmentManager.js:1950` and replacement paths near
`:1724-1748` can rehash large files while a transaction is active.

Benefit: reduce database contention and callback delays. Effort: high. Risk: high.
Moving a final check outside the transaction without retaining the attachment
reservation and detecting replacement introduces a check/use race.
Acceptance: forced replacement between every phase, commit/rollback exceptions,
interruption/restart, two-reader saves, source/target tampering, plus measured
transaction occupancy below 100 ms without changing durable recovery semantics.

### 4. P2: Reduce unchanged-library polling work

Status: **measured linear work**. `reader.js:3555` queries all relative linked
attachments every 30 seconds, then checks each PDF's file token before evaluating
mode. Even Standard mode performs N checks. Dual mode costs about 0.82 seconds per
10,000 unchanged PDFs locally, with one DB query and N token checks each poll.

Benefit: fewer filesystem accesses and lower background CPU, especially on mounted
providers. Effort: medium. Risk: medium/high because polling is the fallback for
external changes that produce no Zotero notification.
Proposal: dirty-ID/event queues plus a bounded, staggered fallback scan; account
for per-item mode state before skipping anything. Do not just disable the timer.
Acceptance: bounded detection latency after external replacement, offline/reconnect,
mode transition, conflict deferral, unsaved drafts, two readers, and 100/1,000/10,000
PDF fixtures. Measure cold/cloud files separately before choosing an interval.

### 5. P2: Separate shipped dependency risk from build-tool debt

Status: **reported advisories and verified shipped call paths; exploitability not
tested**. The current lockfiles yield 43 Desktop advisories (9 critical),
29 Connector advisories (0 critical), and 16 worker advisories (0 critical).
These npm counts include transitive/build dependencies and are not counts of
exploitable application flaws. Do not run a blanket `npm audit fix --force`.

Two concrete runtime priorities:

- Worker `fflate` 0.8.2 is imported by `document-worker/src/dom/epub/zip.ts:1-14`.
  `unzipSync` has a malformed-ZIP64 infinite-loop advisory, fixed in 0.8.3.
  [GitHub advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98).
- Connector's locked DOMPurify is copied into production by `connector/build.sh`
  and called by `connector/src/common/ui/ModalPrompt.jsx`. npm labels it a dev
  dependency, but it is shipped. Multiple sanitization advisories apply to the
  locked version; individual option-specific prerequisites need triage.
  [Example advisory](https://github.com/advisories/GHSA-v8jm-5vwx-cfxm).

Benefit: reduce known parser/sanitizer exposure and maintenance noise. Effort:
small/medium for isolated compatible pins; high for the older Babel/Browserify
toolchain. Risk: medium. Acceptance: malformed EPUB/ZIP timeout fixtures, DOM
sanitizer tests for the actual used options, worker core/browser tests, Connector
production tests, and packaged asset verification. Follow with a dependency-to-
bundle inventory before prioritizing the remaining advisory totals.

### 6. P3: Avoid duplicate terminal coordinator state writes

Status: **source-confirmed redundant path; benefit not benchmarked**.
`annotationStorageCoordinator.js:386-407` can save a non-Dual no-pending state in
the normal branch and then save the same compact state again while clearing an
already-empty recovery value. `_saveState` at `:1183` always performs REPLACE and
JSON serialization. Durable intermediate writes elsewhere protect restart and
must remain separate.

Benefit: fewer DB writes/WAL churn during repeated no-op reconciliation. Effort:
small. Risk: medium. Acceptance: count terminal writes on unchanged Standard,
PDF-only and Dual states; retain every crash-injection/restart test, pending native
repair, tombstone and conflict test. Optimize only the proven identical terminal
write, not all journal writes.

### 7. P3: Trim verified build overhead and obsolete compatibility paths

Status: **mixed confirmed structure and unmeasured opportunities**.

- Connector needs a small Desktop asset surface but its pinned Desktop submodule
  brings another full dependency graph under recursive initialization. Scope a
  minimal dependency-init command before changing its official compatible pin.
- Worker source hashing now correctly tracks owned content and rejects dirty
  dependencies. Warm checks were about 0.20 seconds; hashing tests/docs also causes
  unnecessary rebuilds when only those files change. An explicit build-input
  manifest could narrow the key, but omitted inputs would recreate stale builds.
- `js-build/reader.js:48` tests the Promise returned by `fs.pathExists` without
  awaiting it in the source-build fallback. Public prebuilt downloads passed; the
  missing-output fallback branch was not exercised. Add a failure fixture first.
- `annotationStorageCoordinator.js:1123` still has a fallback for an absent worker
  digest API, though the owned worker/manager now supplies it. Removal is a
  candidate, not proof that all callers/test doubles support the new contract.
  Version-1 persisted-state migration is not obsolete merely because builds are new.

Benefit: faster setup/rebuilds and clearer supported contracts. Effort: small to
medium. Risk: medium. Acceptance: fresh clone with no private cache, missing public
bundle fallback, dirty/untracked worker changes, dependency pin changes, and old
profile/state migration tests. Do not replace preserved source with a private
precompiled worker cache.

### 8. P3: Batch preference-driven work where profiling justifies it

Status: **unmeasured hypotheses**. Config Editor observes all preferences and
re-enumerates, sorts, reads and rebuilds visible rows on each event
(`preferences/configEditor.js:31,115`). Enabling several download types can repeat
the per-library `saveTx` loop (`automaticAttachmentDownloads.js:132,224`).

Benefit: less repeated UI/DB work during burst updates. Effort: small. Risk: medium
for draft/focus preservation and download eligibility. Acceptance: event/query
counts for burst changes, Config Editor draft/caret/focus tests, new-value visibility,
and next-sync downloads after enabling each format. Profile first; the current
100-row rendering cap already limits DOM work.

## Historical findings rechecked

- Transaction callback errors: the upstream DB implementation now logs errors from
  post-commit callbacks and does not pretend committed data rolled back
  (`db.js:489-578`). Updated DB tests, including commit-callback and discarded
  rollback-callback cases, passed in the 293-test focused run. The earlier finding
  is resolved for those covered paths; migration transactions still have the
  separate duration issue above.
- Path containment: now reproduced in the native updated runtime, not merely
  inferred from a Node stand-in. Still open, recommendation 1.
- Dependencies: rescanned against updated lockfiles, with shipped/runtime examples
  separated from build-only candidates. No claim of a complete exploit audit.
- Reader startup reservation: discovered during integration, repaired, and covered
  by failure/retry and reader UI checks. It is not deferred as an optimization.

## Proposed first batch

Select these separately after reviewing this report:

1. Canonical-root safety fix and adversarial path fixtures.
2. Isolated fflate/DOMPurify pin updates with shipped-runtime regression tests.
3. Streaming worker hashing while retaining the existing identity checks.

Then consider terminal state-write deduplication and staggered polling. Defer the
larger transaction redesign until the hashing change has been measured. No
product behavior, polling interval, schema, or dependency pin was changed solely
to implement these recommendations.

## Reproduction

Use the no-space checkout, build first, and never reuse a personal Zotero profile:

```sh
CI=1 ZOTEROMERGE_BENCHMARKS=1 \
  ZOTEROMERGE_BENCHMARK_OUTPUT=/private/tmp/zoteromerge-benchmarks.json \
  ZOTEROMERGE_AUDIT_OUTPUT=/private/tmp/zoteromerge-boundary.json \
  test/runtests.sh efficiencyBenchmark efficiencyAudit
```

The harness rejects non-automated execution and creates/removes disposable fixtures.
Restore the baseline tag into a separate no-space checkout to repeat the baseline;
initialize its recorded dependencies and use its recorded Gecko runtime. Never
switch a working checkout with unpreserved files to the baseline.
