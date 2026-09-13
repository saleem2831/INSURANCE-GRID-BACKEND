# READY(2) Full Regression Report

Generated: 2026-09-13T09:56:56.493Z

**Overall: PASS**
- Canonical insurers: 26 (PASS)
- Source files tested: 25
- Passed: 25
- Failed: 0

| Company | File | Role | Parser | Rules | Mappings | Extractor | Status |
|---|---|---|---|---:|---:|---|---|
| MAGMA | MAGMA Comp Grid-Sep.xlsx | PAYOUT_GRID | MAGMA | 22351 | 6855 |  | **PASS** |
| MAGMA | MAGMA SATP_Grid_Sep.xlsb | PAYOUT_GRID | MAGMA | 7 | 8514 |  | **PASS** |
| LIBERTY | LIBERTY SEP.xlsx | PRODUCT_GRID | LIBERTY | 4498 | 0 |  | **PASS** |
| ROYAL_SUNDARAM | ROYAL GCV_Comp_Grid_Sep.xlsx | PRODUCT_GRID | ROYAL_SUNDARAM | 3087 | 0 |  | **PASS** |
| ROYAL_SUNDARAM | ROYAL Other_than_GCV_Comp_Grid_Sep.xlsx | PRODUCT_GRID | ROYAL_SUNDARAM | 2718 | 0 |  | **PASS** |
| ROYAL_SUNDARAM | ROYAL Pvt Car Grid Sep.xlsx | PRODUCT_GRID | ROYAL_SUNDARAM | 1188 | 0 |  | **PASS** |
| ROYAL_SUNDARAM | RTO_NO_Master_2026_27_CV_v1.xlsx | RTO_MASTER | AUXILIARY_RTO_MAPPING | 0 | 5646 |  | **PASS** |
| IFFCO_TOKIO | IFFCO GRID.pdf | PAYOUT_GRID | PDF:IFFCO_TOKIO | 1177 | 0 | PDFTOTEXT_LAYOUT | **PASS** |
| CHOLA_MS | CHOLA September'26.pdf | PAYOUT_GRID | PDF:CHOLA_MS | 1526 | 0 | PDFTOTEXT_LAYOUT | **PASS** |
| NATIONAL_INSURANCE | National SEP.pdf | PAYOUT_GRID | PDF:NATIONAL_INSURANCE | 98 | 0 | TESSERACT_OCR | **PASS** |
| SBI_GENERAL | SBI SEP.xlsx | PRODUCT_GRID | SBI_GENERAL | 6312 | 7752 |  | **PASS** |
| GO_DIGIT | DIGIT PAN INDIA - SEP.xlsx | PRODUCT_GRID | GO_DIGIT | 9684 | 19759 |  | **PASS** |
| UNITED_INDIA | United SEP.pdf | PAYOUT_GRID | PDF:UNITED_INDIA | 69 | 0 | PDFTOTEXT_LAYOUT | **PASS** |
| ICICI_LOMBARD | Aug 2026 Grid - ICICI (1).xlsx | PAYOUT_GRID | ICICI | 3582 | 0 |  | **PASS** |
| HDFC_ERGO | 2.5 - 3.5.pdf | PAYOUT_GRID | PDF:HDFC_ERGO | 78 | 28 | PDFTOTEXT_LAYOUT | **PASS** |
| HDFC_ERGO | 3W Grid v5 with EV v1-1.xlsx | PRODUCT_GRID | HDFC_ERGO | 280 | 250 |  | **PASS** |
| HDFC_ERGO | 3W Grid v5 with EV v1.xlsx | PRODUCT_GRID | HDFC_ERGO | 280 | 250 |  | **PASS** |
| HDFC_ERGO | Pvt Car New Grid Eff 1st Feb'25 (7).pdf | PAYOUT_GRID | PDF:HDFC_ERGO | 117 | 0 | PDFTOTEXT_LAYOUT | **PASS** |
| HDFC_ERGO | Pvt Car SATP all details.xlsx | PRODUCT_GRID | HDFC_ERGO | 31401 | 349 |  | **PASS** |
| HDFC_ERGO | TW Non New Grid ST.xlsx | PRODUCT_GRID | HDFC_ERGO | 112 | 0 |  | **PASS** |
| HDFC_ERGO | TW SA-OD Grid ST.xlsx | PRODUCT_GRID | HDFC_ERGO | 91 | 0 |  | **PASS** |
| TATA_AIG | Private car TP April 26-TATA AIG.xlsx | PRODUCT_GRID | TATA_AIG | 3080 | 0 |  | **PASS** |
| TATA_AIG | RTO master_TATA AIG.xlsx | RTO_MASTER | AUXILIARY_RTO_MAPPING | 0 | 4080 |  | **PASS** |
| TATA_AIG | TATA AIG.xlsx | PRODUCT_GRID | TATA_AIG | 13464 | 0 |  | **PASS** |
| TATA_AIG | TATA RTO CLUSTER 1.xlsx | CLUSTER_MASTER | AUXILIARY_RTO_MAPPING | 0 | 4507 |  | **PASS** |

## Failures / warnings requiring action

## Source spot checks

### ROYAL_SUNDARAM — RTO_NO_Master_2026_27_CV_v1.xlsx
- PASS: Royal mapping master > 1000

### IFFCO_TOKIO — IFFCO GRID.pdf
- PASS: IFFCO comp green first slab 10%
- PASS: IFFCO GREEN/RED heat-map derivation

### CHOLA_MS — CHOLA September'26.pdf
- PASS: Chola PDF rules > 1000

### NATIONAL_INSURANCE — National SEP.pdf
- PASS: National OCR rules > 50

### SBI_GENERAL — SBI SEP.xlsx
- PASS: SBI executable rules > 1000

### GO_DIGIT — DIGIT PAN INDIA - SEP.xlsx
- PASS: Digit rules > 5k
- PASS: Digit mappings > 10k

### UNITED_INDIA — United SEP.pdf
- PASS: United state rules > 50

### HDFC_ERGO — 2.5 - 3.5.pdf
- PASS: 3W Mumbai COMP 60%
- PASS: Bolero young decline
- PASS: explicit RTO mappings

### HDFC_ERGO — Pvt Car New Grid Eff 1st Feb'25 (7).pdf
- PASS: Zone1 <10k Package Petrol 17.5%
- PASS: HDFC zone derivations

## Accuracy gates applied

- Every executable source file must produce deterministic rules or mappings.
- Every source payout percentage/component must be numeric and within the configured source range (0–500%); signed adjustment rules may be negative.
- Every rule and RTO mapping must retain source audit information.
- Duplicate rule codes inside one source file fail validation.
- PDF extraction must be complete; partial/unavailable extraction fails.
- Mapping-only workbooks are tested as mappings, not incorrectly forced through payout parsers.
- Unknown/unsupported structures remain blocked rather than receiving guessed payouts.
