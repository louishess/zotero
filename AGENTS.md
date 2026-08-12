# Dual annotation storage implementation instructions

These instructions apply to the entire repository unless a deeper `AGENTS.md`
overrides them.

Before changing code for dual annotation storage, read
`DUAL_ANNOTATION_IMPLEMENTATION_DIRECTIONS.md` and
`DUAL_ANNOTATION_STORAGE_PLAN.md` in full. Treat the directions document as the
shared source of truth instead of relying on chat context or remembered prompts.

Preserve unrelated work and submodule state. Do not change the product decisions
that keep the PDF authoritative in dual mode or remove the Box/Zotero
reconciliation protocol. Implement only the assigned commit or file boundary,
run focused tests, and report changed files, test results, assumptions, and any
interface deviation.

Do not commit unless the coordinating agent explicitly assigns commit ownership.
Do not edit `readerTest.js` for new reconciliation coverage; use the dedicated
test file named in the directions document.
