# Analytical and Bioanalytical Chemistry / Springer Link evidence

The controls below were read from the rendered Springer Link DOM in the browser on 2026-09-05 (America/Los_Angeles). The fixture files retain the observed supplementary-section markup and direct media routes; they are compact DOM excerpts rather than guessed URL examples.

## Positive control 1 (recent layout)

- URL: https://link.springer.com/article/10.1007/s00216-026-06632-w
- DOI: `10.1007/s00216-026-06632-w`
- Title: “Regions of interest multivariate curve resolution for liquid chromatography with ion mobility high-resolution tandem mass spectrometry: analysis of plastic additives”
- Citation date: September 2026
- Observed DOM: `section[data-title="Supplementary Information"]` contains one `a[data-test="supp-info-link"]` with the direct route `https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-026-06632-w/MediaObjects/216_2026_6632_MOESM1_ESM.docx`; the rendered link text is “Supplementary file1 (DOCX 1.43 MB) (download DOCX )”.

## Positive control 2 (older layout)

- URL: https://link.springer.com/article/10.1007/s00216-020-02957-2
- DOI: `10.1007/s00216-020-02957-2`
- Title: “Discrimination between pathogenic and non-pathogenic E. coli strains by means of Raman microspectroscopy”
- Citation date: December 2020
- Observed DOM: `section[data-title="Electronic supplementary material"]` contains one `a[data-test="supp-info-link"]` with the direct route `https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00216-020-02957-2/MediaObjects/216_2020_2957_MOESM1_ESM.pdf`; the rendered link text is “ESM 1 (download PDF )”.

## Verified no-SI control

- URL: https://link.springer.com/article/10.1007/s00216-026-06704-x
- DOI: `10.1007/s00216-026-06704-x`
- Title: “Euroanalysis 2025 - Analytics 5.0: Answering societal challenges”
- Citation date: September 2026
- Observed DOM: the page has only its article metadata sections (`Author information`, `Additional information`, `Rights and permissions`, and `About this article`) and no `section[data-title]` containing a supplementary-information link.

