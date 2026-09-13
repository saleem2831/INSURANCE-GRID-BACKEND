import fs from "fs";
import path from "path";
import { readExcelBuffer } from "../imports/excelReader";
import { parseWorkbookForCompany } from "../imports/parserRegistry";

const root = process.env.GRID_VALIDATION_DIR || process.argv[2];
if (!root) throw new Error("Provide GRID_VALIDATION_DIR or pass a folder containing the insurer XLSX files.");

const cases: Array<[string,string]> = [
  ["SHRIRAM", "1st August 26 - Shriram.xlsx"],
  ["ICICI_LOMBARD", "Aug 2026 Grid - ICICI (1).xlsx"],
  ["LIBERTY", "Aug'26 Branch Grid_v1 - Liberty (1).xlsx"],
  ["MAGMA_HD", "Comprehensive Grid Aug 26-Magma.xlsx"],
  ["HDFC_ERGO", "GCV Grid Effective 01042026 - With RTO List-HDFC ERGO.xlsx"],
  ["TATA_AIG", "GCV GRID-TATA AIG.xlsx"],
  ["GO_DIGIT", "PAN India_20240509 26-27-GO DIGIT.xlsx"],
  ["TATA_AIG", "Private car TP April 26-TATA AIG.xlsx"],
  ["INDUSIND", "School Bus Pan India August 1st Grid-INDUSIND.xlsx"]
];

let failed = false;
for (const [code,fileName] of cases) {
  const full = path.join(root,fileName);
  if (!fs.existsSync(full)) { console.error(`MISSING ${fileName}`); failed = true; continue; }
  const parsed = parseWorkbookForCompany(code, readExcelBuffer(fs.readFileSync(full)), { fileName, version: "SOURCE-VALIDATION" });
  const badPct = parsed.rules.filter(r => r.result.type === "PAYOUT" && (r.ruleKind || "BASE") !== "ADJUSTMENT" && (!Number.isFinite(Number(r.result.percentage)) || Number(r.result.percentage) < 0 || Number(r.result.percentage) > 100));
  const missingAudit = parsed.rules.filter(r => !r.source?.sheet || !r.source?.row || r.source?.originalText === undefined);
  const ok = parsed.rules.length > 0 && parsed.errors.length === 0 && badPct.length === 0 && missingAudit.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${code.padEnd(14)} rules=${parsed.rules.length} mappings=${parsed.rtoMappings.length} errors=${parsed.errors.length} invalidPct=${badPct.length} missingAudit=${missingAudit.length} :: ${fileName}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
