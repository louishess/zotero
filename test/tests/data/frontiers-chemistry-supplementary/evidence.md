# Frontiers in Chemistry supplementary evidence

Live observations were made in the Codex in-app browser on 2026-09-05 (America/Los_Angeles; browser timestamps were 2026-09-06T06:14:27Z through 06:17:20Z).

## Positive controls

- `https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2021.685783/full` (published 17 June 2021): the DOM exposed `meta[name="citation_firstpage"] = 685783`, a `#supplementaryMaterial` section, one `li.SupplementalDataV4__file` named `Data Sheet 1.pdf`, and a download anchor with `data-event="articleSupplementalData-button-download"` at `https://public-pages-files-2025.frontiersin.org/articles/685783/file/Data_Sheet_1.pdf/685783_supplementary-materials_datasheets_1_pdf/3`.
- `https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2025.1682298/full` (published 1 December 2025): the DOM exposed `meta[name="citation_firstpage"] = 1682298`, the same `#supplementaryMaterial`/`SupplementalDataV4__file` structure, and one `Data Sheet 1.docx` download at `https://public-pages-files-2025.frontiersin.org/articles/1682298/file/Data_Sheet_1.docx/1682298_data-sheet_1/1`.

The existing API URL observed in the translator, `https://www.frontiersin.org/articles/getsupplementaryfilesbyarticleid?articleid=685783&ispublishedv2=false`, returned the site's rendered `404 Not found` page when opened on the same date. The translator therefore reads the observed direct DOM links first and keeps the API as a bounded fallback. Its normalized file descriptors currently accept the observed direct `/articles/ID/file/...` route only. Other historical API file routes and live API success remain unverified; fixture success is not proof of historical coverage.

## No-SI control

- `https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2025.1572259/full` (Editorial, published 20 February 2025): the DOM exposed `meta[name="citation_firstpage"] = 1572259`, no supplementary section, no `SupplementalDataV4__file`, and no `articleSupplementalData-button-download` link. This is the verified no-SI control used by the production-gate test.

## Synthetic edge coverage

`api-fallback-edges.json` models the legacy API response path and is explicitly synthetic: it omits `citation_firstpage` so the production code must recover article ID `685783` from the observed DOI suffix, then exercises an absent `FileName` (derive the filename from the observed `/file/` pathname segment), signed query preservation, duplicate URLs, a cross-article URL, unsupported chemical/data extensions, credentialed and port-qualified URLs, a same-article viewer route, and unknown `.sh`, `.jar`, and `.com` code artifacts. The production test keeps the unknown artifacts as URL-only links without MIME mappings or execution and rejects the unintended routes. A separate synthetic fixture adds an unrelated `/articles/999999/` anchor while the current DOI has no firstpage metadata, proving that cited links cannot poison article-ID discovery. The test also injects a rejected API promise to verify metadata completion and the primary PDF are preserved after optional SI failure. These edges are not claims about files returned by either live control.
