# Journal of Materials Science / Springer Link evidence

Observed in the browser on 2026-09-05 (America/Los_Angeles). The live pages were read through the browser DOM; selectors below are based on the rendered DOM, not guessed URL routes or minified HTTP responses.

## Positive control 1 (recent layout)

- URL: https://link.springer.com/article/10.1007/s10853-025-11859-6
- Date shown: 28 November 2025
- Title: “A versatile and simplified mechanochemical route for creating porous graphene-containing nanostructures from diverse graphite wastes”
- Observed DOM: `section[data-title="Supplementary Information"]` contains `a[data-test="supp-info-link"]` with `href="https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs10853-025-11859-6/MediaObjects/10853_2025_11859_MOESM1_ESM.docx"`; link text is “Supplementary file1 (DOCX 10545 KB) (download DOCX)”.

## Positive control 2 (older layout and image ESM)

- URL: https://link.springer.com/article/10.1007/s10853-020-04916-9
- Date shown: 19 June 2020
- Title: “In situ investigation of atmospheric plasma-sprayed Mn–Co–Fe–O by synchrotron X-ray nano-tomography”
- Observed DOM: `section[data-title="Electronic supplementary material"]` contains `a[data-test="supp-info-link"]` links to `.../10853_2020_4916_MOESM1_ESM.tif` and `.../10853_2020_4916_MOESM5_ESM.tif`, with “download TIF” labels. The page shows five supplementary items total: two direct image-file anchors and three video-player iframes (`MOESM2`–`MOESM4`) with no direct file `href`; the three video items are an explicit access/blocker limitation and are excluded from extraction.

## Verified no-SI control

- URL: https://link.springer.com/article/10.1007/s10853-026-13717-5
- Date shown: 05 September 2026
- Title: “High-temperature molten salt electrophoretic deposition of TiB2 coatings on graphite: an experimental and first-principles study”
- Observed DOM: the page has a `section[data-title="Data availability"]`, but no `section[data-title]` whose value contains “Supplementary” and no `a[data-test="supp-info-link"]`.

The fixtures preserve these article DOI/path relationships and add bounded synthetic edges for duplicate signed URLs, relative media URLs, mixed marked/unmarked file anchors, query-only extensions, unknown `.blob`, `.com`, and executable-format files (retained as links), cross-article media, same-DOI viewer routes, executable URL schemes, credentialed URLs, article routes and video routes.
