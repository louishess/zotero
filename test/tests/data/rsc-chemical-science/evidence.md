# Chemical Science live DOM evidence

Captured 2026-09-05 in the Codex in-app browser. Direct article landing URLs redirected to the canonical RSC issue routes below; the article pages were readable in the browser DOM.

## Positive PDF control

- Landing URL: `https://pubs.rsc.org/en/content/articlelanding/2024/sc/d3sc05729a`
- Canonical URL: `https://pubs.rsc.org/sc/article/15/11/3879/827846/Modular-synthesis-of-functional-libraries-by`
- DOI meta: `10.1039/d3sc05729a`
- Main PDF anchor: `https://pubs.rsc.org/sc/article-pdf/15/11/3879/9402275/d3sc05729a.pdf`
- Supplementary anchor observed under `.widget-ArticleDataSupplements .dataSuppLink a.js-download-file-gtm-datalayer-event[href*="/article-supplement/"]`: `https://pubs.rsc.org/sc/article-supplement/827846/pdf/d3sc05729a1_suppl/`
- Visible label and `aria-label`: `Supplementary information (PDF)` / `Download Supplementary information (PDF)`.

## Positive XLSX control

- Landing URL: `https://pubs.rsc.org/en/content/articlelanding/2024/sc/d4sc03017f`
- Canonical URL: `https://pubs.rsc.org/sc/article/15/36/14548/869332/Improving-reproducibility-through-condition-based`
- DOI meta: `10.1039/d4sc03017f`
- Main PDF anchor: `https://pubs.rsc.org/sc/article-pdf/15/36/14548/10035908/d4sc03017f.pdf`
- Supplementary anchor observed under `.widget-ArticleDataSupplements .dataSuppLink a.js-download-file-gtm-datalayer-event[href*="/article-supplement/"]`: `https://pubs.rsc.org/sc/article-supplement/869332/xlsx/d4sc03017f1_suppl/`
- Visible label and `aria-label`: `Supplementary information (XLSX)` / `Download Supplementary information (XLSX)`.

## Verified no-SI control

- URL: `https://pubs.rsc.org/en/content/articlelanding/2024/sc/d4sc90085e`
- Canonical URL: `https://pubs.rsc.org/sc/article/15/18/6593/870687/Contents-list`
- DOI meta: `10.1039/D4SC90085E`
- Page type/title: `Front/Back Matter` / `Contents list`
- DOM query `a[href*="/article-supplement/"]`: zero matches; no supplementary-data section was present.

The journal-index URL itself returned an RSC security-verification page, so discovery used the supplied direct article URLs and did not attempt to bypass the challenge. No supplementary-file request was made during DOM inspection.
