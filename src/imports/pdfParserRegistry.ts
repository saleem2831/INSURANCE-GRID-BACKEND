import { GridImportResult } from "./types";
import { PdfPageText } from "./pdfReader";
import { canonicalCompanyCode } from "../config/insurers";
import { parseCholaPdf } from "./parsers/cholaPdf.parser";
import { parseIffcoPdf } from "./parsers/iffcoPdf.parser";
import { parseNationalPdf } from "./parsers/nationalPdf.parser";
import { parseUnitedPdf } from "./parsers/unitedPdf.parser";
import { parseHdfcPdf } from "./parsers/hdfcPdf.parser";

export type PdfParserCode = "CHOLA_MS" | "IFFCO_TOKIO" | "NATIONAL_INSURANCE" | "UNITED_INDIA" | "HDFC_ERGO";

export function tryGetPdfParserForCompany(companyCode: string): PdfParserCode | null {
  const code = canonicalCompanyCode(companyCode);
  if (["CHOLA_MS", "IFFCO_TOKIO", "NATIONAL_INSURANCE", "UNITED_INDIA", "HDFC_ERGO"].includes(code)) return code as PdfParserCode;
  return null;
}

export function parsePdfForCompany(
  companyCode: string,
  pages: PdfPageText[],
  context: { fileName: string; version: string }
): GridImportResult {
  const parser = tryGetPdfParserForCompany(companyCode);
  if (!parser) {
    return {
      insurerCode: canonicalCompanyCode(companyCode),
      fileName: context.fileName,
      rules: [],
      rtoMappings: [],
      warnings: [],
      errors: [
        `PARSER_REQUIRED: executable PDF parsing is not configured for ${canonicalCompanyCode(companyCode)}. Keep this document in review until a validated parser/profile is approved.`
      ]
    };
  }
  switch (parser) {
    case "CHOLA_MS": return parseCholaPdf(pages, context);
    case "IFFCO_TOKIO": return parseIffcoPdf(pages, context);
    case "NATIONAL_INSURANCE": return parseNationalPdf(pages, context);
    case "UNITED_INDIA": return parseUnitedPdf(pages, context);
    case "HDFC_ERGO": return parseHdfcPdf(pages, context);
  }
}
