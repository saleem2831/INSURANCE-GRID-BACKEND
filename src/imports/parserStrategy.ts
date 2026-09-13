import mongoose from "mongoose";
import GridParserProfile from "../models/GridParserProfile";
import { ExcelSheet } from "./excelReader";
import { parseWorkbookForCompany, tryGetParserForCompany } from "./parserRegistry";
import { parseGenericTableWorkbook } from "./parsers/genericTable.parser";

export async function parseWithStrategy(
  company: any,
  sheets: ExcelSheet[],
  context: { fileName: string; version: string },
  requestedProfileId?: string | null
) {
  const builtIn = tryGetParserForCompany(company.code);
  if (builtIn) {
    return {
      parserName: builtIn,
      parserProfileId: null as any,
      parsed: parseWorkbookForCompany(company.code, sheets, context)
    };
  }

  let profile: any = null;
  if (requestedProfileId && mongoose.Types.ObjectId.isValid(requestedProfileId)) {
    profile = await GridParserProfile.findOne({
      _id: requestedProfileId,
      insuranceCompanyId: company._id,
      active: true
    }).lean();
  }
  if (!profile) {
    profile = await GridParserProfile.findOne({
      insuranceCompanyId: company._id,
      active: true
    }).sort({ updatedAt: -1 }).lean();
  }
  if (!profile) {
    return {
      parserName: "PARSER_REQUIRED",
      parserProfileId: null as any,
      parsed: {
        insurerCode: company.code,
        fileName: context.fileName,
        rules: [],
        rtoMappings: [],
        warnings: [],
        errors: [
          "PARSER_REQUIRED: no built-in parser or active generic parser profile exists for this insurer. Configure a parser profile or add a custom parser before activation."
        ]
      }
    };
  }

  return {
    parserName: `GENERIC_PROFILE:${profile.name}`,
    parserProfileId: profile._id,
    parsed: parseGenericTableWorkbook(company.code, sheets, context, profile as any)
  };
}
