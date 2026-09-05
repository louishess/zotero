# SI downloads and dual PDF annotations

This branch combines the committed three-mode annotation implementation with the SI Desktop preference fix and the six-publisher translator revision. The matching Connector remains a separate repository at `4c0baf1a7a975b31867eb9a1280aaf5a3fdd9925`.

The merge preserved both changes to `defaults/preferences/zotero.js`: SI discovery defaults on, and annotation storage defaults to Standard for fresh profiles. Existing explicit preferences and the legacy annotation migration remain intact. The translator submodule is `70e15ee7`; the annotation worker is `7310261`. See `source-manifest.json` for exact inputs.

The later linked-folder extension and uncommitted automatic-download controls are outside this branch. Original working copies were preserved separately, including their diffs and untracked files.

## Review

- `c376949763`: merge the two Desktop histories without replaying shared commits.
- `761b7eeb5f`: advance translators from the older Desktop SI pin to all six publisher fixes.
- Subsequent integration changes regenerate localization from Fluent sources and add combined regression coverage and reproducibility records.

Compare this branch to `52ac324e2b` to review the SI integration into annotations. Compare to `522858cc8` to review the annotation addition to SI. Neither merge required conflict-marker resolution or taking an entire shared file from one side.

## Recreate the custom worker

The repository includes `annotation-worker.bundle`, containing the four custom worker commits after upstream `6d0c0ce45d96a4ed5b697927306b1e9207a02041`. It avoids depending on another local worktree or on unpublished branch refs. In a fresh, non-recursive clone, initialize the worker first:

```sh
git clone --no-checkout https://github.com/zotero/document-worker.git document-worker
git -C document-worker bundle verify ../integration/annotation-worker.bundle
git -C document-worker fetch ../integration/annotation-worker.bundle HEAD
git -C document-worker checkout --detach 731026106dabe56aef921351b7c3480678ee25fc
git submodule update --init --recursive
git lfs pull
```

The bundle requires the named upstream ancestor. If using a shallow worker clone, fetch that ancestor before importing the bundle. Use the pinned submodule commits rather than updating to upstream HEAD.

## Build and test

Build Desktop from a checkout whose absolute path contains no spaces. The durable review checkout can be cloned to a temporary build directory. Install the selected lockfiles with `npm ci`, regenerate strings with `npm run ftl-to-json`, run `npm run build`, and package with `app/scripts/dir_build -p m -f`. The packager verifies its configured Gecko runtime hash and signs the local macOS application ad hoc.

Desktop's builder downloads revision-specific reader, editor, and worker assets or builds locally. Verify the staged worker bytes against the selected revision's build, and inspect the staged application for both the SI preference/server bridge and annotation coordinator. Do not reuse an existing application's `omni.ja`.

```sh
CI=1 test/runtests.sh server_connector annotationStorageMode annotationStorageCoordinator reader preferences_advanced
CI=1 test/runtests.sh annotations syncLocal
cd document-worker
npm ci
npm run typecheck
npm run test:pdf
```

The Desktop harness creates a temporary profile and library and disables automatic sync. It also stages a test-enabled application. Run `app/scripts/dir_build -p m -f` with `ZOTERO_TEST=0` afterward for the review application without the test harness.

In the separate matching Connector checkout:

```sh
npm ci
./build.sh -d
env HEADLESS=true npm test
```

Keep Connector `src/zotero` at its compatible `4c05017a6` revision. It is a source dependency for the extension, not the combined Desktop executable.

## Distribution and limitations

Use a distinct enclosing release directory and retain the internal `Zotero.app` filename expected by build tools. Keep the unpacked Connector in `connector-manifestv3/`. This is a local review build, not a notarized release or an installed replacement.

Live publisher transfer tests were not performed against the personal library. Science and Wiley still require normal authenticated-browser transfer validation as described in the SI handoff. Automated fixture/descriptor checks cannot establish current publisher availability or access. See the external build report for actual commands, counts, artifact hashes, and any remaining checks.
