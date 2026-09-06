# MDPI Materials supplementary evidence

Observed 2026-09-05 in the CUA in-app browser against live MDPI pages. The extractor makes no supplementary network request; it reads the article's `#supplementaryModal` DOM.

## Positive controls

- Recent Materials article: <https://www.mdpi.com/1996-1944/19/16/3558>
  - `#supplementaryModal` was present.
  - The modal contained `/1996-1944/19/16/3558/s1?version=1787318969` with link text `ZIP-Document` and adjacent text `(ZIP, 81 KB)`.
  - The article body also contained `section#app1-materials-19-03558` and the article-linked landing URL `https://www.mdpi.com/article/10.3390/ma19163558/s1`.
- Older Materials article: <https://www.mdpi.com/1996-1944/10/1/86>
  - `#supplementaryModal` contained `/1996-1944/10/1/86/s1?version=1484984785`, link text `PDF-Document`, and adjacent text `(PDF, 693 KB)`.
  - The body contained `section#app1-materials-10-00086` with the observed supplementary URL `https://www.mdpi.com/1996-1944/10/1/86/s1`.

## Verified no-SI control

- No-SI Materials article: <https://www.mdpi.com/1996-1944/10/1/93>
  - Live DOM evaluation returned no `#supplementaryModal`, no `[id^="app1-"]` supplementary section, and no `/sN` supplementary link. The download menu exposed the main PDF/XML/ePub routes only.

## Synthetic fixture coverage

The edge fixture is synthetic and clearly separate from the live observations. It covers same-named distinct files, signed query preservation, an unknown query-string suffix, relative URLs, unobserved chemistry formats (`.cif`, `.mzML`), bad-scheme/off-host/landing/viewer/PHP routes, and a cited article's `/s1` route. Unknown chemistry files remain linked because no MIME type is inferred for them.
