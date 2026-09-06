# MDPI Polymers supplementary evidence

Observed 2026-09-05 in the CUA in-app browser against live MDPI pages. The extractor makes no supplementary network request; it reads the article's `#supplementaryModal` DOM.

## Positive controls

- Recent Polymers article: <https://www.mdpi.com/2073-4360/18/17/2167>
  - `#supplementaryModal` was present.
  - The modal contained `/2073-4360/18/17/2167/s1?version=1788589189` with link text `ZIP-Document` and adjacent text `(ZIP, 868 KB)`.
  - The article body also contained `section#app1-polymers-18-02167` and the article-linked landing URL `https://www.mdpi.com/article/10.3390/polym18172167/s1`.
- Older Polymers article: <https://www.mdpi.com/2073-4360/10/1/105>
  - `#supplementaryModal` contained `/2073-4360/10/1/105/s1?version=1516643719`, link text `Supplementary`, and adjacent text `(PDF, 231 KB)`.

## Verified no-SI control

- No-SI Polymers article: <https://www.mdpi.com/2073-4360/18/17/2173>
  - Live DOM evaluation returned no `#supplementaryModal`, no `[id^="app1-"]` supplementary section, no `/sN` supplementary link, and a download menu containing only `Download PDF` and `Download XML`.

## Synthetic fixture coverage

The edge fixture is synthetic and clearly separate from the live observations. It covers fragment deduplication, signed query preservation, same-filename distinct files, relative URLs, unobserved chemistry formats (`.cif`, `.mzML`), a code file (`.py`), unknown chemical data, article scope, and bad-scheme/off-host/landing/viewer/PHP routes. Unknown chemistry and code files remain linked because no MIME type is inferred for them.
