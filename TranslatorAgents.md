# Chemistry supplementary-information translator work

Status: proposed operating guide, prepared 2026-09-05. No translator upgrade is implemented by this document. No earlier `TranslatorAgents.md` was found in the active repositories. This is the explicitly requested specialist guide; [AGENTS.md](AGENTS.md) remains the master source/build/acceptance record. Read it and the translator checkout's own `AGENTS.md` before assignments.

## Objective and boundaries

Capture an article's main PDF and all publisher-designated supplementary files while preserving citation metadata, attachment identity, user download preferences and ordinary access controls. These are **web translators**. A chemistry article on a multidisciplinary platform is in scope. Books, preprints and arbitrary data-repository harvesting need separate assignments.

Coverage is a journal-and-platform inventory, not a fixed list of famous journals. Organic, inorganic, analytical, physical, theoretical/computational, medicinal, biological, polymer, materials, electrochemical, environmental, food/agricultural, energy and chemical-engineering journals are included. Include multidisciplinary journals that publish chemical research, active titles, relevant archives and publisher transfers. A journal's historical and current domains may require different translators.

## Small assignments

The supervisor supplies one publisher/platform layout, one named translator file (or a discovery-only assignment), owned fixtures/test files, two positive article URLs and one negative control, acceptance criteria, and a request ceiling. For shared `Atypon Journals.js`, assign only one host-scoped change at a time. Two agents must never edit that file concurrently.

An agent may inspect, implement the assigned extractor and run its isolated tests. It must not stage, commit, push, change branches, update submodule pins/lockfiles, modify the core downloader or preference bridge, touch the personal library, or launch shared Desktop acceptance runs. The supervisor integrates translator commits into both Desktop and Connector and owns their build pins. Different journals on the same layout normally belong to one implementation task and separate verification tasks.

First inspect current behavior and upstream changes. Do not equate an old `lastUpdated` header with a broken translator. Report a working upstream extractor or preference-only solution instead of rewriting it. Do not modernize unrelated metadata code just because it uses older APIs.

## Fixes from least intensive to most intensive

Stop at the first sufficient tier. The request budgets below are proposed engineering defaults, excluding the existing metadata/main-PDF requests; exceed them only after the supervisor agrees to a specific need.

| Tier | Approach | Typical change | Additional discovery requests |
| --- | --- | --- | --- |
| 0 | Reuse existing support | Verify preference bridge, upstream patch, existing link/file mode and correct translator selection. Add a regression fixture if needed. | 0 |
| 1 | Read links already in the supplied document | Add a narrowly scoped SI-section selector; read `href`, `download`, file labels and media type. Reuse the metadata translator's `itemDone` handler. | 0 |
| 2 | Read structured data already in the document | Parse article-scoped JSON/JSON-LD or embedded state for a file manifest. Use `JSON.parse`; never `eval` script text. Prefer explicit file IDs and URLs. | 0 |
| 3 | Retrieve one canonical article/SI page | Follow an observed full-text or SI-tab URL when the abstract lacks the file list. Parse the returned document using the same extractor. | At most 1 |
| 4 | Query an observed official API | Resolve the article ID once and request the official supplementary-file list. Validate its shape; keep optional SI failure separate from metadata completion. Frontiers is an existing example. | Normally 1–2 |
| 5 | Follow an official repository/CDN handoff | Resolve an article-linked Figshare or other repository record, then enumerate its actual files. Match DOI/article identity, handle bounded pagination and stable file identifiers. ACS is an existing example. | Explicit bounded budget; normally no more than 3 discovery calls |
| 6 | Escalate a platform/core limitation | A session-bound download, missing MIME/download semantics, Connector handoff, or shared translator API requires a supervisor-owned design and separate tests. Return an evidence packet; do not expand the assignment. | No unbounded retries or crawl |

Inspect current page structure with the translator checkout's page-inspection/API-capture tools when available; otherwise use the available browser UI and observed DOM/network documentation. Do not implement selectors based solely on search snippets, guessed file names, URL-number enumeration, or bot-challenge HTML. A translator receives a static document: it cannot click the live page or call arbitrary page functions. For new requests use supported `request`, `requestText`, `requestJSON` or `requestDocument` helpers, not new uses of deprecated `ZU.doGet`, `ZU.doPost` or `ZU.processDocuments`. Confirm those helpers exist in the pinned Desktop and Connector sandbox before relying on them.

## Attachment contract

- SI is additive. Keep DOI, creators, journal fields, item type, metadata error behavior and the working primary-PDF route. Do not count an SI PDF as the main PDF or replace the main file merely because a supplement has “article” in its name.
- Honor `attachSupplementary` and `supplementaryAsLink`. Keep `downloadAssociatedFiles` and the seven device-local automatic-download switches independent. Disconnected Connector behavior must return to its own preferences. Translators must not encode cloud-folder behavior.
- Scope links to the article's SI section or verified article-linked record. Exclude reference links, cited papers, figure viewers, correction notices and repository landing pages masquerading as files. Accept only HTTP(S) file routes on observed publisher/approved CDN hosts; reject executable URL schemes and unintended local/private-network destinations.
- Resolve relative URLs against the actual document URL; remove fragments for deduplication. Preserve signed and file-selecting query parameters. Deduplicate repeated URLs/file IDs for this article only. Never deduplicate distinct files by title, filename or matching bytes.
- Derive filename/type from observed download metadata or explicit format paths. Infer extension from URL pathname, not a query-string suffix. Do not label a ZIP or unknown binary as PDF. Never use a HEAD request per attachment merely to classify it when the page already supplies enough information.
- Preserve separate descriptors for same-named main/SI PDFs. Keep descriptive titles and exact file extensions. No automatic archive extraction, macro execution or opening downloaded code.
- Current RSC/Wiley/Frontiers and other helpers leave unknown MIME types as links. Do not silently claim these are downloaded, or override this behavior across publishers in a small task. Add needed chemical formats explicitly where the downloader supports them; a generic unknown-binary download policy belongs in a separate supervisor task.
- Chemistry acceptance includes PDF, DOC/DOCX, XLS/XLSX, CSV/TSV/TXT/MD, ZIP and available audio/video, plus representative CIF/FCF/HKL, XYZ/MOL/SDF/CML/CDX/CDXML, JCAMP-DX, NMR/raw-data archives, mzML/mzXML, HDF5/NetCDF, and computational input/output files. Formats vary by journal: test actual supplied files rather than inventing every format on every site.
- Optional SI errors must not abort a valid citation or main-PDF save. Complete each item exactly once, await SI work before completion, log a concise reason without cookies/tokens, and preserve any valid descriptors already found. A 403/429/challenge is an access-blocked result, not “no SI”. Respect `Retry-After`; do not bypass CAPTCHA, broaden User-Agent spoofing or remove access checks. Preserve the existing narrow Figshare exception.

## Required evidence per assignment

1. **Detection and metadata:** single article, multiple selection and cancellation; DOI case-insensitive comparison; metadata/main-PDF unchanged.
2. **Discovery fixtures:** recent positive control, a second layout/year/journal positive, and a verified no-SI control. Add duplicates, relative URLs, query-bearing downloads, same filenames, malformed/missing metadata, non-file links and non-target hosts for shared translators.
3. **Preferences:** SI off produces no SI discovery traffic; file mode and link mode remain distinct. Integration owner verifies associated-file and type switches, explicit-download bypass and Desktop-connected/disconnected behavior.
4. **Failure isolation:** API/page unavailable, 403/429, empty/malformed file manifest and one failed SI transfer do not prevent valid metadata from completing. Bound requests and concurrency, cancel unnecessary work, and avoid per-file metadata requests.
5. **Real transfer:** in a disposable profile/library only, save through the matching Connector into Desktop. Record main PDF and every expected SI separately: URL/DOI, descriptor count, saved child IDs, MIME/extension, byte count, checksum and format validation. Check PDF signature, archive validity and representative chemistry-file structure; reject HTML error bodies. Link-mode children are not downloaded files. Keep publisher extraction, HTTP access, byte transfer and annotation persistence as separate statuses.
6. **Handoff:** exact files changed; tier chosen and why; request count; tests actually run; live controls/date/results; remaining access blockers; interface requests; known failure paths. No “all journals supported” claim from one successful DOI.

Use the pinned translator repository's lint and fixture tooling. Syntax-check translator code after its JSON metadata header is removed. The existing Connector `publisherSupplementaryTranslatorTest.mjs` illustrates deterministic helper tests, but they do not replace browser/desktop transfer acceptance. Shared-runtime and two-Mac tests remain supervisor work.

## Coverage registry and rollout

Before claiming universal chemistry coverage, create a supervisor-owned inventory with one row per ISSN-L/title/platform-era. Fields: title, ISSNs/aliases, chemistry subject, publisher, observed host/layout, translator ID and file, source-catalog URL/date, SI route/tier, supported formats, positive/negative controls, metadata/discovery/transfer statuses, access blocker, last tested revision/date, next owner. Statuses must distinguish **uninspected**, **implemented**, **fixture-passed**, **transfer-passed**, **access-blocked**, and **verified-no-SI**. Unknown is never no-SI.

Seed from publisher catalogs, then cross-check a chemistry serial index and open journal metadata for omissions. Audit society, regional/non-English and discontinued/transferred titles explicitly. Measure both inventory coverage and transfer-tested platform/layout coverage; report the denominator and unresolved titles. A family below is a candidate workstream, not a guarantee about every member's current host.

| Wave | Platform and translator candidate | Chemistry targets/examples | Work to assign |
| --- | --- | --- | --- |
| 0 | ACS Publications; RSC Publishing; Wiley Online Library | JACS/JOC/Organic Letters/Analytical Chemistry; Chemical Science/ChemComm/PCCP/J. Mater. Chem.; Angewandte/Chemistry Europe/Advanced Materials families | Close existing live-transfer gaps; broaden controls to core chemistry and chemical data files, including current versus legacy layouts. Existing six-publisher support is retained. |
| 0 | Nature Publishing Group; Cell Press; Atypon Journals (Science host only) | Nature Chemistry/Nature Catalysis/Nature Materials/Nature Communications; Chem/Joule/Cell Reports Physical Science; Science/Science Advances | Preserve current work; complete primary PDF and SI transfer controls per layout. Nature's prior 22-file success proves only its control. |
| 1 | ScienceDirect.js | Tetrahedron, Talanta, Analytica Chimica Acta, Journal of Chromatography, Electrochimica Acta, Chemical Engineering Journal, catalysis/polymer/energy families | Upgrade existing SI function: current legacy `MMCvLABEL_SRC` selector, narrow MIME list, URL-extension parsing, deduplication and main-PDF replacement behavior. Observe current appendix/CDN routes before changing them. |
| 1 | Springer Link.js | Analytical and Bioanalytical Chemistry, Journal of Materials Science, Theoretical Chemistry Accounts; BMC/chemistry titles on verified Springer layouts | Add article SI/ESM extraction; inspect the current canonical article host and legacy `link.springer.com` redirects rather than assuming the Nature translator covers Springer. |
| 1 | MDPI Journals.js | Molecules, Catalysts, Polymers, Materials, Nanomaterials, Electrochem and related titles | Add SI links to existing Embedded Metadata flow; no dedicated SI extractor was found in the reviewed pin. Start with zero-request DOM extraction. |
| 1 | Frontiers.js | Frontiers in Chemistry; Frontiers in Materials and related chemical-engineering titles | Verify/upgrade existing API support, not a new extractor. Check article-ID discovery, absent filename handling, link mode and chemical formats. |
| 2 | Beilstein platform; actual detected generic translator first | Beilstein Journal of Organic Chemistry; Beilstein Journal of Nanotechnology | Discovery task first: inspect supporting-information downloads and embedded metadata/XML. No dedicated Beilstein-named translator exists in this checkout. Prefer a small site wrapper if generic metadata already works. |
| 2 | IUCr platform; actual detection first | Acta Crystallographica, IUCrJ, IUCrData, Journal of Applied Crystallography | Capture CIF/structure factors and SI without confusing the main article or check reports. No dedicated IUCr-named translator was found. |
| 2 | Thieme.js; Taylor and Francis+NEJM.js | Synthesis/Synlett; synthetic, coordination, analytical and physical-chemistry titles | Inspect host-specific SI tabs/downloads; scope changes away from unrelated journals/NEJM. |
| 2 | AIP.js; Institute of Physics.js; APS-Physics.js | Journal of Chemical Physics, physical/materials/electrochemical interfaces | Verify modern platforms and society-title transfers; add SI only on observed layouts. |
| 2 | De Gruyter Brill.js; Oxford University Press.js; Cambridge Core.js | Pure and Applied Chemistry and related titles; society chemistry and materials journals | Determine current host for each title, then implement one bounded layout at a time. |
| 3 | Atypon Journals.js, host-scoped; SAGE Journals.js | World Scientific/Annual Reviews and relevant SAGE chemistry/materials titles | Do not generalize the Science extractor to all Atypon sites. Separate host fixtures and ownership. |
| 3 | J-Stage.js; SciELO.js; journal-specific/OJS platforms | Japanese, Brazilian, Latin American and other regional chemistry/society journals | Inventory current versus transferred titles; inspect language/layout variations and archive SI. Include Bulletin of the Chemical Society of Japan/Chemistry Letters platform history. |
| 3 | PLoS Journals.js; Copernicus.js; Hindawi Publishers.js and other current hosts | Multidisciplinary chemistry, atmospheric chemistry, legacy/current open-access chemistry titles | Inventory first; add article-designated SI only. Recheck moved or discontinued journals before editing a legacy translator. |
| 3 | Bentham, Science China/KeAi, CSIRO, NRC/CSP, EDP, Karger where relevant, and remaining society/regional publishers | Medicinal, general, environmental and materials chemistry long tail | Discover active metadata translator/host, not guessed filenames. Route to an existing family where appropriate; add new wrappers only for proven gaps. |


Wave 1 work may proceed independently after supervisor triage; large-scale migration or a general-use release still depends on the safety/security items in AGENTS.md. The first practical batch is **ScienceDirect hardening, Springer SI, MDPI SI, and Frontiers verification**, one owner per file. Core ACS/RSC/Wiley live acceptance runs alongside these when ordinary access is available.

## Source grounding for discovery

Checked 2026-09-05. These sources establish available SI/platform scope, not tested selectors or transfer success:

- [Zotero syncing and linked attachments](https://www.zotero.org/support/sync)
- [RSC journal catalog](https://pubs.rsc.org/en/Journals)
- [ScienceDirect article-page and supplementary-material navigation](https://www.elsevier.support/sciencedirect/answer/what-can-i-do-on-an-article-page)
- [Springer Journal of Materials Science SI guidelines](https://link.springer.com/journal/10853/submission-guidelines)
- [MDPI Molecules](https://www.mdpi.com/journal/molecules)
- [Frontiers in Chemistry](https://www.frontiersin.org/journals/chemistry/about)
- [Beilstein journal information, supporting files and XML](https://www.beilstein-journals.org/bjoc/theJournal)
- [IUCrData submission/data-file scope](https://iucrdata.iucr.org/x/services/submitinstructions.html)
