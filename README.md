# ZoteroMerge

A custom [Zotero](https://www.zotero.org/) build with three annotation storage modes,
supplementary-information downloads, linked cloud folders, per-format download
controls, and a searchable Config Editor. This is not an official Zotero release.

## Source layout

- Desktop: repository root
- Connector: `connector/`
- Customized document worker: `document-worker/`
- Customized translators: `translators/`
- Unmodified upstream dependencies: pinned submodules in root `.gitmodules`

All custom component histories are retained through non-squashed subtree merges.
The maintained branch is `ZoteroMerge`. Exact inputs and frozen upstream revisions
are in [the source manifest](integration/source-manifest.json).
[AGENTS.md](AGENTS.md) is the authoritative maintenance guide.

## Build on macOS

Use a checkout whose full path contains no spaces. Prerequisites: Git with Git LFS,
Node.js/npm, Xcode command-line tools, Python 3, and standard macOS archive tools.
The September 2026 validation uses Node 26.5.0 and npm 11.17.0.

```sh
git clone --branch ZoteroMerge https://github.com/louishess/zotero.git ~/Developer/ZoteroMerge
cd ~/Developer/ZoteroMerge
git submodule update --init --recursive
git lfs pull --include='app/mac/updater.tar.xz' --exclude=''
npm ci
npm run ftl-to-json
app/scripts/fetch_xulrunner -p m
npm run build
node scripts/verify-consolidation.cjs
ZOTERO_TEST=0 app/scripts/dir_build -p m -f
npm --prefix connector ci
(cd connector && ./build.sh -p b -v 4.999.2026.926)
```

Desktop output: `app/staging/Zotero.app`. Connector output:
`connector/build/manifestv3/`. Build commands do not install either product.
The custom worker builds locally; official reader/editor bundles may be downloaded
from Zotero's public build service, with source-build fallback. Never copy a private
worker cache or depend on an old sibling checkout.

For a committed, clean checkout with dependencies already installed, create signed
local packages and then smoke-test the production app with a disposable library:

```sh
node scripts/package-local.cjs ../ZoteroMerge-packages/rc-2026-09-25
node scripts/smoke-package.cjs ../ZoteroMerge-packages/rc-2026-09-25/ZoteroMerge.app
```

The output directory must not already exist. The package command includes a
source/dependency manifest and SHA-256 checksums. Ad-hoc signing is not Apple
notarization. Archive timestamps/signatures can differ across builds; compare the
unpacked source/assets when checking reproducibility.

## Test

```sh
node --test scripts/test-worker-source-hash.cjs
node --test test/tests/*SupplementaryTest.mjs
CI=1 test/runtests.sh
npm --prefix document-worker run test:core
(cd document-worker && CI=1 npm run test:runtime:browser)
(cd connector && ./build.sh -d && npm test)
```

The Desktop harness creates a disposable profile/library and uses port 23124.
Never point it at a personal profile. For repeatable local performance measurements:

```sh
CI=1 ZOTEROMERGE_BENCHMARKS=1 \
  ZOTEROMERGE_BENCHMARK_OUTPUT=/private/tmp/zoteromerge-benchmarks.json \
  test/runtests.sh efficiencyBenchmark
```

## Update

1. Preserve dirty files and create verified recovery bundles before restructuring.
2. Fetch and record full upstream Desktop, Connector and translator SHAs. Read the
   Desktop worker gitlink to choose its corresponding upstream worker revision.
3. Merge Desktop normally. Its worker/translator gitlinks may conflict with the
   owned directories: retain the directories and merge those upstream histories
   separately, not with a blanket `ours` strategy.
4. Use `git subtree merge --prefix=connector <connector-sha>`,
   `git subtree merge --prefix=document-worker <worker-sha>`, and
   `git subtree merge --prefix=translators <translator-sha>`, without `--squash`.
5. Mirror imported nested submodule registration into root `.gitmodules`, then
   initialize the exact pins. Keep Connector's official Desktop asset pin compatible.
6. Review clean semantic intersections, run regressions and disposable package
   checks, update the manifest, then publish explicit branches/tags. Do not rebase,
   force-push, or install packages as part of an update.

See [the efficiency audit](docs/efficiency-audit.md) for measured findings and
separately scoped recommendations. Live publisher access and multi-device cloud
acceptance must not be inferred from fixture tests.
