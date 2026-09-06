# MDPI Catalysts supplementary evidence

Observed 2026-09-05 in the CUA in-app browser against live MDPI pages. The extractor makes no supplementary network request; it reads the article's `#supplementaryModal` DOM.

## Positive controls

- Recent Catalysts article: <https://www.mdpi.com/2073-4344/16/9/804>
  - `#supplementaryModal` was present.
  - The modal contained `/2073-4344/16/9/804/s1?version=1788595127` with link text `ZIP-Document` and adjacent text `(ZIP, 702 KB)`.
  - The full HTML body also contained `section#app1-catalysts-16-00804`, whose observed article-linked landing URL was `https://www.mdpi.com/article/10.3390/catal16090804/s1`.
- Legacy Catalysts article: <https://www.mdpi.com/2073-4344/15/1/98>
  - `#supplementaryModal` contained `/2073-4344/15/1/98/s1?version=1737369813`, link text `ZIP-Document`, and adjacent text `(ZIP, 6171 KB)`.
  - The body contained `section#app1-catalysts-15-00098` with the observed DOI landing URL `https://www.mdpi.com/article/10.3390/catal15010098/s1`.

## Plain/full-HTML route

- The observed DOI/full-HTML entry <https://www.mdpi.com/article/10.3390/catal16090802> redirected to the canonical article URL <https://www.mdpi.com/2073-4344/16/9/802>.
- After the redirect, the DOM contained both `#supplementaryModal` and `section#app1-catalysts-16-00802`. The modal exposed `/2073-4344/16/9/802/s1?version=1788521919` with `(ZIP, 650 KB)`; the full HTML section exposed the article-linked landing URL `https://www.mdpi.com/article/10.3390/catal16090802/s1`.
- The fixture records the alias and final canonical location. The test verifies that the direct modal file wins and the landing page is not attached as a file.

## Verified no-SI control

- No-SI Catalysts article: <https://www.mdpi.com/2073-4344/16/9/803>
  - Live DOM evaluation returned `#supplementaryModal: null` and no `[id^="app1-"]` supplementary section.

## Synthetic fixture coverage

The edge fixture is synthetic and clearly separate from the live observations. It covers fragment deduplication, signed query preservation, same-filename distinct URLs, unobserved chemical data formats (`.cif`, `.mzML`) remaining linked, unknown chemical types remaining linked, relative/landing/viewer/PHP routes, off-host and executable schemes, and a cited article's `/s1` route. These entries verify URL and identity safeguards; they are not claims about files or publisher MIME metadata observed on the three controls.
