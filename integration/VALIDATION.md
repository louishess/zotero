# Integration validation — 2026-09-04

Verified locally on macOS with Node v26.5.0 and npm 11.17.0. All application tests used the repository harness's temporary profile and disposable library. No production library saves or file migrations were performed.

| Check | Result |
| --- | --- |
| Desktop locked dependency installation, Fluent generation, JS/assets build | Passed |
| `CI=1 test/runtests.sh server_connector annotationStorageMode annotationStorageCoordinator reader preferences_advanced` | 77/77 passed before adding the new integration cases |
| `CI=1 test/runtests.sh annotations syncLocal` | 90/90 passed |
| `CI=1 test/runtests.sh annotationStorageCoordinator` after integration test additions | 15/15 passed: 8 existing coordinator tests and 7 real-worker integration tests |
| Worker `npm run typecheck` | Passed |
| Worker `npm run test:pdf` | 188/188 passed |
| Worker `npm run build` | Passed; fresh worker, metadata, and structured-document-text assets match the revision-specific assets byte-for-byte |
| Six publisher translator syntax checks | Passed |
| Connector `npm ci` and `./build.sh -d` | Passed |
| Connector `HEADLESS=true npm test` with Puppeteer's Chrome for Testing 150 | 106 passed, 9 opt-in live diagnostics pending |
| Deterministic RSC, Science, Wiley helper tests run separately | 3 passed (also included in the Connector suite) |

The test counts above overlap and must not be added together as a unique test total.

The new real-worker cases verify same-filename attachment isolation, distinct storage paths and native parents, SI edit/deletion without changing the main attachment, recovery after local coordinator state is cleared, and all six storage-mode transitions. They use valid PDF note annotations. The existing reader suite covers all supported annotation types, multiple readers, and external file replacement.

Initial attempts at the new fixture exposed missing sort-index data, invented highlight text inconsistent with the actual PDF text, and invalid note geometry. The fixture was corrected to supply valid annotation data; no feature code was changed to make the test pass. The final note geometry matches the worker's 22-point note representation.

The Connector's first browser attempts failed under sandbox restrictions or stable Chrome's extension loading. Its unchanged test harness passes with the pinned Chrome for Testing runtime outside the sandbox. Live publisher diagnostics remain intentionally disabled.

Staged-content checks verified the SI default, Standard annotation default, preference server bridge, coordinator/conflict UI, all six translator files, and the annotation worker. The packaged translator files match the pinned source byte-for-byte. Worker SHA-256: `96ad07a1d027f338aa01f98e35e97fdfd1779982279982883c19ac3f33365223`.

Remaining manual acceptance: authenticated publisher transfers (especially the outstanding Science and Wiley cases), broader filename portability cases such as case-only/Unicode names, and independent real cloud/data-sync delivery. This branch is ready for combined review and further work; these automated results are not evidence of completed live publisher or cloud-service acceptance.
