import { ExcelSheet } from "./excelReader";
import { GridImportResult } from "./types";
import { parseMagmaWorkbook } from "./parsers/magma.parser";
import { parseHdfcWorkbook } from "./parsers/hdfc.parser";
import { parseIciciWorkbook } from "./parsers/icici.parser";
import { parseDigitWorkbook } from "./parsers/digit.parser";
import { parseTataAigWorkbook } from "./parsers/tataAig.parser";
import { parseLibertyWorkbook } from "./parsers/liberty.parser";
import { parseShriramWorkbook } from "./parsers/shriram.parser";
import { parseIndusindWorkbook } from "./parsers/indusind.parser";
import { parseRoyalSundaramWorkbook } from "./parsers/royalSundaram.parser";
import { parseSbiGeneralWorkbook } from "./parsers/sbiGeneral.parser";
import { canonicalCompanyCode } from "../config/insurers";

export type ParserCode =
  | "MAGMA"
  | "ICICI"
  | "HDFC_ERGO"
  | "GO_DIGIT"
  | "TATA_AIG"
  | "LIBERTY"
  | "SHRIRAM"
  | "INDUSIND"
  | "ROYAL_SUNDARAM"
  | "SBI_GENERAL";

const parserMap: Record<string, ParserCode> = {
  MAGMA: "MAGMA", MAGMA_HD: "MAGMA", MAGMA_HDI: "MAGMA", MAGMA_GRID: "MAGMA",
  ICICI: "ICICI", ICICI_LOMBARD: "ICICI", ICICI_GRID: "ICICI",
  HDFC: "HDFC_ERGO", HDFC_ERGO: "HDFC_ERGO",
  DIGIT: "GO_DIGIT", GO_DIGIT: "GO_DIGIT", GO: "GO_DIGIT",
  TATA: "TATA_AIG", TATA_AIG: "TATA_AIG",
  LIBERTY: "LIBERTY", SHRIRAM: "SHRIRAM", INDUSIND: "INDUSIND", INDUS: "INDUSIND",
  ROYAL_SUNDARAM: "ROYAL_SUNDARAM", ROYAL: "ROYAL_SUNDARAM",
  SBI_GENERAL: "SBI_GENERAL", SBI: "SBI_GENERAL"
};

export function tryGetParserForCompany(companyCode: string): ParserCode | null {
  const canonical = canonicalCompanyCode(companyCode);
  if (canonical === "MAGMA") return "MAGMA";
  return parserMap[canonical] ?? parserMap[String(companyCode).trim().toUpperCase()] ?? null;
}

export function getParserForCompany(companyCode: string): ParserCode {
  const parser = tryGetParserForCompany(companyCode);
  if (!parser) throw new Error(`No built-in grid parser configured for company ${companyCode}`);
  return parser;
}

export function parseWorkbookForCompany(
  companyCode: string,
  sheets: ExcelSheet[],
  context: { fileName: string; version: string }
): GridImportResult {
  const parser = getParserForCompany(companyCode);
  switch (parser) {
    case "MAGMA": return parseMagmaWorkbook(sheets, context);
    case "HDFC_ERGO": return parseHdfcWorkbook(sheets, context);
    case "ICICI": return parseIciciWorkbook(sheets, context);
    case "GO_DIGIT": return parseDigitWorkbook(sheets, context);
    case "TATA_AIG": return parseTataAigWorkbook(sheets, context);
    case "LIBERTY": return parseLibertyWorkbook(sheets, context);
    case "SHRIRAM": return parseShriramWorkbook(sheets, context);
    case "INDUSIND": return parseIndusindWorkbook(sheets, context);
    case "ROYAL_SUNDARAM": return parseRoyalSundaramWorkbook(sheets, context);
    case "SBI_GENERAL": return parseSbiGeneralWorkbook(sheets, context);
  }
}

export function builtInParserCapabilities() {
  return Object.entries(parserMap).map(([alias, parser]) => ({ alias, parser }));
}
