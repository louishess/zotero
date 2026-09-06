# Tetrahedron / ScienceDirect review evidence

Reviewed September 5–6, 2026. Candidate controls:

- https://www.sciencedirect.com/science/article/pii/S0040402024000553
- https://www.sciencedirect.com/science/article/pii/S004040202400070X
- https://www.sciencedirect.com/science/article/pii/0040402082801683 (candidate negative; not verified)

Live article DOM access was blocked by publisher challenges. Indexed supplementary-information references do not establish a current selector or prove that the candidate negative has no SI. The HTML fixtures are synthetic regression inputs for the existing legacy `MMCvLABEL_SRC` contract, not captured publisher markup. The synthetic modern block intentionally remains inert. Current-layout discovery and real byte transfers remain access-blocked/unverified.

The reviewed change hardens the existing zero-additional-request extractor: article PII and publisher file-route validation, pathname/download-filename types, query-preserving fragment deduplication, unknown formats as links, and additive SI that preserves the main PDF. Numeric archive PIIs remain supported. A failed optional PDF lookup does not abort valid RIS metadata; production processRIS tests assert exactly one completion with SI on and off.

Validation: six isolated Mocha tests, translator syntax, matching Desktop/Connector translator bytes, and diff whitespace check. These checks do not establish current publisher coverage or successful downloads.
