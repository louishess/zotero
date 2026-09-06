# MDPI Molecules supplementary evidence

Observed 2026-09-05 in the CUA in-app browser against the live MDPI pages. The extractor makes no additional network request; it reads the article DOM.

## Positive controls

- Recent Molecules article: <https://www.mdpi.com/1420-3049/31/17/3117>
  - `#supplementaryModal` was present.
  - The modal contained the observed direct download link `/1420-3049/31/17/3117/s1?version=1788605568` with link text `ZIP-Document` and adjacent text `(ZIP, 1193 KB)`.
  - The article section also exposed `https://www.mdpi.com/article/10.3390/molecules31173117/s1`; this is an article-linked landing URL, so the extractor uses the explicit modal download instead.
- Legacy Molecules article: <https://www.mdpi.com/1420-3049/23/10/2454>
  - `#supplementaryModal` contained `/1420-3049/23/10/2454/s1?version=1537869219`, link text `ZIP-Document`, and adjacent text `(ZIP, 388 KB)`.

The page also showed the current PDF download and publisher CDN resources on `www.mdpi.com` and `pub.mdpi-res.com`; these are the approved observed HTTP(S) hosts in the translator.

## Negative control

- No-SI Molecules article: <https://www.mdpi.com/1420-3049/31/17/3113>
  - DOM evaluation returned `#supplementaryModal: null` and no matching `section[id^="app1-"]` supplementary section or relevant SI link.

## Synthetic fixture coverage

The JSON fixtures use the observed positive and negative controls above. Additional edge entries are synthetic regression inputs, clearly separate from the live observations: duplicate fragments, same-name distinct URLs, an unknown query-string suffix, relative `/s4`, malformed/javascript and off-host links, HTML/PHP/viewer routes, an article landing URL carrying a misleading `(ZIP, 1 KB)` label, and a cited article's `/s1` route. These synthetic entries verify deduplication, link fallback, URL validation, and current-article route scoping; they are not claims about controls observed on the live pages.
