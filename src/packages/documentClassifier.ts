import path from "path";
import { ExcelSheet } from "../imports/excelReader";
import { GRID_DOCUMENT_ROLES } from "../models/GridDocument";

export type GridDocumentRole = typeof GRID_DOCUMENT_ROLES[number];

export interface DocumentClassification {
  role: GridDocumentRole;
  productScope: string[];
  required: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

function token(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function inferProductScope(fileName: string, sheets: ExcelSheet[] = []): string[] {
  const text = token(`${fileName} ${sheets.map(s => s.name).join(" ")}`);
  const products = new Set<string>();
  if (/PRIVATE CAR|PVT CAR|PVTCAR/.test(text)) products.add("PRIVATE_CAR");
  if (/TWO WHEELER|\b2W\b|\bTW\b/.test(text)) products.add("TWO_WHEELER");
  if (/\bGCV\b|GOODS CARRY/.test(text)) products.add("GCV");
  if (/\bPCV\b|PASSENGER CARRY|SCHOOL BUS|\bBUS\b|\bTAXI\b/.test(text)) products.add("PCV");
  if (/\b3W\b|THREE WHEEL/.test(text) && !products.size) {
    products.add("GCV");
    products.add("PCV");
  }
  return [...products];
}

export function classifyGridDocument(fileName: string, sheets: ExcelSheet[] = []): DocumentClassification {
  const ext = path.extname(fileName).toLowerCase();
  // IMPORTANT: role classification is filename-first. A normal all-in-one payout workbook
  // can legitimately contain sheets named RTO Mapping / Cluster; that does NOT make the
  // whole workbook an RTO master.
  const fileText = token(path.basename(fileName));
  const productScope = inferProductScope(fileName, sheets);

  if (ext === ".pdf") {
    return {
      role: "REFERENCE_DOCUMENT",
      productScope,
      required: false,
      confidence: "HIGH",
      reason: "PDF retained for source/reference. V6 does not guess executable payout rules from PDFs."
    };
  }
  if (/RTO/.test(fileText) && /CLUSTER/.test(fileText)) {
    return { role: "CLUSTER_MASTER", productScope, required: true, confidence: "HIGH", reason: "Filename identifies an RTO/cluster mapping document." };
  }
  if (/RTO/.test(fileText) && /(MASTER|MAPPER|MAPPING| MAP )/.test(` ${fileText} `)) {
    return { role: "RTO_MASTER", productScope, required: true, confidence: "HIGH", reason: "Filename identifies an RTO master/mapping document." };
  }
  if (/INCREMENTAL|ADDITIONAL PAYOUT|ADD ON PAYOUT/.test(fileText)) {
    return { role: "INCREMENTAL_GRID", productScope, required: true, confidence: "HIGH", reason: "Filename identifies an incremental/additional payout document." };
  }
  if (/EXCLUSION|DECLINE|BLOCKED|BLOCK LIST/.test(fileText)) {
    return { role: "EXCLUSION_GRID", productScope, required: true, confidence: "HIGH", reason: "Filename identifies an exclusion/decline document." };
  }
  if (/GUIDELINE|NOTES|INSTRUCTION/.test(fileText)) {
    return { role: "GUIDELINES", productScope, required: false, confidence: "MEDIUM", reason: "Filename identifies guidelines/notes." };
  }
  if (/MASTER|LOOKUP|MAKE MODEL|MODEL MAPPING/.test(fileText) && !/GRID/.test(fileText)) {
    return { role: "LOOKUP_MASTER", productScope, required: false, confidence: "MEDIUM", reason: "Filename identifies a supporting lookup/master." };
  }
  if (productScope.length) {
    return { role: "PRODUCT_GRID", productScope, required: true, confidence: "MEDIUM", reason: "Product-specific payout workbook detected from filename/sheets." };
  }
  return { role: "PAYOUT_GRID", productScope, required: true, confidence: "LOW", reason: "Defaulted to main payout grid; confirm role during package validation." };
}
