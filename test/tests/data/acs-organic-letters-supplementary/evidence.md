# Organic Letters live DOM evidence

Observed 2026-09-05 in the ACS Publications browser page. The current Silverchair article pages expose the same controls used by `ACS Publications.js`: `a[data-doctype="dataSupplementDoc"][href]` and `.article_content-left .suppl-anchor[href]`.

- Recent positive: [Cobalt-Photoredox-Catalyzed C–H Annulation of N-Aryl Benzamides with 2,5-Dihydrofuran](https://pubs.acs.org/orlef7/article/28/35/10887/5277030/Cobalt-Photoredox-Catalyzed-C-H-Annulation-of-N), DOI `10.1021/acs.orglett.6c02348`, Volume 28 Issue 35 (2026-09-04). The inspected DOM returned two `dataSupplementDoc` anchors: `ol6c02348_si_001` at the observed `/zip/` route and `ol6c02348_si_002` at the observed `/pdf/` route.
- Older positive: [Deaminative Ring Contraction for the Modular Synthesis of Pyrido[n]helicenes](https://pubs.acs.org/orlef7/article/28/16/5021/5141169/Deaminative-Ring-Contraction-for-the-Modular), DOI `10.1021/acs.orglett.5c04734`, Volume 28 Issue 16 (2026-04-24). The inspected DOM returned one `dataSupplementDoc` anchor at the observed `/pdf/` route `ol5c04734_si_001`.
- Verified no-SI control: [Issue Editorial Masthead](https://pubs.acs.org/orlef7/article/doi/10.1021/olv028i035_2125128/5420534/Issue-Editorial-Masthead), DOI `10.1021/olv028i035_2125128`, current issue 28(35). The inspected DOM returned no supporting-information heading, no `dataSupplementDoc` anchor and no `.suppl-anchor` anchor.

The fixture/API cases for Figshare identity, signed query parameters, duplicate filenames, unknown chemistry/code files, malformed/oversized manifests and failures are deterministic translator-helper tests; they are not claims of live transfer success. No challenge or CAPTCHA was bypassed.
