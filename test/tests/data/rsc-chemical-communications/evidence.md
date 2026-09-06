# Chemical Communications live DOM evidence

Captured 2026-09-06 in the Codex in-app browser through ordinary public article pages. No supplementary file was downloaded and no security challenge was bypassed.

## Positive current control

- Landing URL: `https://pubs.rsc.org/en/content/articlelanding/2026/cc/d6cc03753d`
- Canonical URL: `https://pubs.rsc.org/cc/article/62/69/17165/1280508/Photo-induced-generation-of-1-3`
- DOI meta: `10.1039/d6cc03753d`
- Main PDF anchor: `https://pubs.rsc.org/cc/article-pdf/62/69/17165/13500458/d6cc03753d.pdf`
- Supplementary anchors observed under `a.js-download-file-gtm-datalayer-event[href*="/article-supplement/"]`:
  - `https://pubs.rsc.org/cc/article-supplement/1280508/pdf/d6cc03753d1_suppl/` — `Supplementary information (PDF)`
  - `https://pubs.rsc.org/cc/article-supplement/1280508/cif/d6cc03753d2_suppl/` — `Crystal structure data (CIF)`

## Positive older control

- Landing URL: `https://pubs.rsc.org/en/content/articlelanding/2012/cc/c2cc35874c`
- Canonical URL after ordinary redirect: `https://pubs.rsc.org/cc/article-abstract/48/87/10715/362518/Planarized-B-phenylborataanthracene-anions?redirectedFrom=fulltext`
- DOI meta: `10.1039/c2cc35874c`
- Supplementary anchors observed under the same RSC supplementary-link selector:
  - `https://pubs.rsc.org/cc/article-supplement/362518/pdf/c2cc35874c_suppl/` — `Supplementary information (PDF)`
  - `https://pubs.rsc.org/cc/article-supplement/362518/txt/c2cc35874c_suppl/` — `Crystal structure data (TXT)`

## Verified no-SI control

- Canonical URL: `https://pubs.rsc.org/cc/article/62/69/17073/1298434/Front-cover`
- DOI meta: `10.1039/D6CC90295B`
- Page type/title: `Cover` / `Front cover`
- DOM query `a[href*="/article-supplement/"]`: zero matches; the page had only a non-file `Supplementary Material` disclosure control.

The RSC journal index initially displayed a security-verification page, so controls were opened directly and verified from their public article DOMs without attempting to bypass the challenge.
