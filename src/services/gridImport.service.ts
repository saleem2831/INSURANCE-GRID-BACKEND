import mongoose from "mongoose";
import InsuranceCompany from "../models/InsuranceCompany";
import GridImport from "../models/GridImport";
import CommissionGrid from "../models/CommissionGrid";
import CommissionRule from "../models/CommissionRule";
import RtoMapping from "../models/RtoMapping";
import { readExcelBuffer } from "../imports/excelReader";
import { calculateFileHash } from "../imports/fileHash";
import { parseWithStrategy } from "../imports/parserStrategy";
import { canonicalCompanyCode } from "../config/insurers";
import {
  deleteStoredGridFile,
  persistGridFile,
  readStoredGridFile,
  storedGridFileExists
} from "../storage/gridFileStorage";

interface CompanySelector {
  insuranceCompanyId?: string;
  companyCode?: string;
  companyName?: string;
}

interface PreviewGridImportInput extends CompanySelector {
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  fileName: string;
  fileSize: number;
  buffer: Buffer;
  gridScope?: string;
  parserProfileId?: string;
}

interface CommitGridImportInput {
  importId: string;
  buffer?: Buffer;
  fileName?: string;
  activate?: boolean;
}

async function resolveCompany(input: CompanySelector) {
  if (input.insuranceCompanyId) {
    if (!mongoose.Types.ObjectId.isValid(input.insuranceCompanyId)) {
      throw new Error("Invalid insuranceCompanyId");
    }
    const company = await InsuranceCompany.findById(input.insuranceCompanyId);
    if (!company) throw new Error("Insurance company not found");
    return company;
  }

  const code = canonicalCompanyCode(input.companyCode);
  const name = String(input.companyName ?? "").trim();
  if (!code) throw new Error("Provide insuranceCompanyId or companyCode");

  let company = await InsuranceCompany.findOne({ code });
  if (!company) {
    if (!name) throw new Error("companyName is required when creating a new insurance company");
    company = await InsuranceCompany.create({
      code,
      name,
      shortName: name,
      active: true
    });
  }
  return company;
}


function logicalGridKey(companyCode: string, fileName: string, explicitScope?: string): string {
  const requested = String(explicitScope || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (requested && requested !== "AUTO") return requested;
  const code = String(companyCode || "").toUpperCase();
  const name = String(fileName || "").toUpperCase();
  if (code === "TATA_AIG" || code === "TATA") {
    if (name.includes("PRIVATE") && name.includes("CAR")) return "PRIVATE_CAR_TP";
    return "CV_TW";
  }
  if (name.includes("PRIVATE") && name.includes("CAR")) return "PRIVATE_CAR";
  if (name.includes("TWO WHEELER") || name.includes("2W") || name.includes("TW")) return "TWO_WHEELER";
  if (name.includes("GCV")) return "GCV";
  if (name.includes("PCV") || name.includes("BUS")) return "PCV";
  return "MOTOR_GRID";
}

function parseDates(effectiveFromRaw: string, effectiveToRaw?: string) {
  const effectiveFrom = new Date(effectiveFromRaw);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Invalid effectiveFrom date");
  let effectiveTo: Date | null = null;
  if (effectiveToRaw) {
    effectiveTo = new Date(effectiveToRaw);
    if (Number.isNaN(effectiveTo.getTime())) throw new Error("Invalid effectiveTo date");
    if (effectiveTo < effectiveFrom) throw new Error("effectiveTo cannot be before effectiveFrom");
  }
  return { effectiveFrom, effectiveTo };
}

export async function previewGridImport(input: PreviewGridImportInput) {
  const company = await resolveCompany(input);
  const version = String(input.version).trim().toUpperCase();
  if (!version) throw new Error("Grid version is required");

  const { effectiveFrom, effectiveTo } = parseDates(input.effectiveFrom, input.effectiveTo);
  const fileHash = calculateFileHash(input.buffer);
  const logicalKey = logicalGridKey(company.code, input.fileName, input.gridScope);

  // Physical-file reuse is separate from logical duplicate detection.
  const anyExistingFile = await GridImport.findOne({ fileHash })
    .sort({ createdAt: -1 })
    .populate("insuranceCompanyId", "code name")
    .lean();

  const exactImport = await GridImport.findOne({
    insuranceCompanyId: company._id,
    version,
    logicalKey,
    fileHash,
    status: { $nin: ["FAILED", "NEEDS_PARSER"] }
  }).sort({ createdAt: -1 }).lean();

  if (exactImport) {
    return {
      duplicate: true,
      fileExists: true,
      action: "DUPLICATE" as const,
      canCommit: false,
      company: { id: company._id, code: company.code, name: company.name },
      version,
      logicalKey,
      parser: exactImport.parser,
      file: { name: input.fileName, size: input.fileSize, hash: fileHash },
      existingImportId: exactImport._id,
      existingGridId: exactImport.gridId ?? null,
      existingStatus: exactImport.status,
      message: "FILE EXISTS: this exact grid file has already been uploaded for this insurer and version."
    };
  }

  const previousImport = await GridImport.findOne({
    insuranceCompanyId: company._id,
    version,
    logicalKey,
    status: { $ne: "FAILED" }
  }).sort({ createdAt: -1 }).lean();

  const action: "CREATE" | "REPLACE" = previousImport ? "REPLACE" : "CREATE";
  const sheets = readExcelBuffer(input.buffer);
  if (!sheets.length) throw new Error("No worksheets found in Excel file");

  const strategy = await parseWithStrategy(company, sheets, { fileName: input.fileName, version }, input.parserProfileId);
  const parsed = strategy.parsed;
  const warnings = [...parsed.warnings];
  const emptySheets = sheets.filter(sheet => sheet.rows.length === 0);
  if (emptySheets.length) warnings.push(`Empty sheets detected: ${emptySheets.map(s => s.name).join(", ")}`);
  if (action === "REPLACE") {
    warnings.push(`A previous ${company.code} ${version} ${logicalKey} import exists. This upload is a revision candidate for the same logical workbook.`);
  }
  if (anyExistingFile) {
    warnings.push("The same physical file bytes already exist in storage. The stored file will be reused instead of creating another disk copy.");
  }

  const persisted = await persistGridFile(input.buffer, input.fileName, fileHash);

  const gridImport = await GridImport.create({
    insuranceCompanyId: company._id,
    version,
    logicalKey,
    effectiveFrom,
    effectiveTo,
    fileName: input.fileName,
    fileHash,
    fileSize: input.fileSize,
    storagePath: persisted.storagePath,
    parser: strategy.parserName,
    parserProfileId: strategy.parserProfileId,
    status: strategy.parserName === "PARSER_REQUIRED" ? "NEEDS_PARSER" : parsed.errors.length ? "PARSED" : "VALIDATED",
    action,
    sheetNames: sheets.map(sheet => sheet.name),
    rulesDetected: parsed.rules.length,
    rtoMappingsDetected: parsed.rtoMappings.length,
    warnings,
    errors: parsed.errors,
    replacesImportId: previousImport?._id ?? null
  });

  return {
    duplicate: false,
    fileExists: Boolean(anyExistingFile) || persisted.alreadyOnDisk,
    importId: gridImport._id,
    action,
    company: { id: company._id, code: company.code, name: company.name },
    version,
    logicalKey,
    effectiveFrom,
    effectiveTo,
    parser: strategy.parserName,
    parserProfileId: strategy.parserProfileId,
    canCommit: parsed.errors.length === 0,
    file: { name: input.fileName, size: input.fileSize, hash: fileHash },
    detected: {
      rules: parsed.rules.length,
      rtoMappings: parsed.rtoMappings.length,
      warnings: warnings.length,
      errors: parsed.errors.length
    },
    rulePreview: parsed.rules.slice(0, 20),
    rtoMappingPreview: parsed.rtoMappings.slice(0, 20),
    previousImport: previousImport
      ? {
          id: previousImport._id,
          fileName: previousImport.fileName,
          fileHash: previousImport.fileHash,
          status: previousImport.status,
          createdAt: previousImport.createdAt
        }
      : null,
    existingPhysicalFile: anyExistingFile
      ? {
          importId: anyExistingFile._id,
          fileName: anyExistingFile.fileName,
          version: anyExistingFile.version,
          status: anyExistingFile.status
        }
      : null,
    workbook: {
      sheetCount: sheets.length,
      sheets: sheets.map(sheet => ({
        name: sheet.name,
        rowCount: sheet.rows.length,
        preview: sheet.rows.slice(0, 6)
      }))
    },
    warnings,
    errors: parsed.errors
  };
}

export async function commitGridImport(input: CommitGridImportInput) {
  if (!mongoose.Types.ObjectId.isValid(input.importId)) throw new Error("Invalid importId");
  const importRow = await GridImport.findById(input.importId);
  if (!importRow) throw new Error("Grid import not found");
  if (importRow.status === "IMPORTED" && importRow.gridId) {
    return { alreadyCommitted: true, importId: importRow._id, gridId: importRow.gridId };
  }
  if (importRow.errors?.length) {
    throw new Error(`Commit blocked because preview has validation errors: ${importRow.errors.join("; ")}`);
  }

  let buffer: Buffer;
  if (input.buffer) {
    const hash = calculateFileHash(input.buffer);
    if (hash !== importRow.fileHash) {
      throw new Error("Commit file does not match the preview file.");
    }
    buffer = input.buffer;
  } else {
    if (!(await storedGridFileExists(importRow.storagePath))) {
      throw new Error("Stored grid file is missing. Preview/upload the file again.");
    }
    buffer = await readStoredGridFile(importRow.storagePath);
  }

  const company = await InsuranceCompany.findById(importRow.insuranceCompanyId);
  if (!company) throw new Error("Insurance company not found for import");
  const sheets = readExcelBuffer(buffer);
  const strategy = await parseWithStrategy(
    company, sheets,
    { fileName: input.fileName || importRow.fileName, version: importRow.version },
    importRow.parserProfileId ? String(importRow.parserProfileId) : null
  );
  const parsed = strategy.parsed;
  if (strategy.parserName === "PARSER_REQUIRED") {
    throw new Error("Commit blocked: this insurer does not yet have an executable parser. Configure a parser profile or add a custom parser, then re-preview the workbook.");
  }

  if (parsed.errors.length) {
    await GridImport.findByIdAndUpdate(importRow._id, { status: "FAILED", errors: parsed.errors });
    throw new Error(`Import validation failed: ${parsed.errors.join("; ")}`);
  }

  if (importRow.action === "REPLACE") {
    const priorGrid = await CommissionGrid.findOne({
      insuranceCompanyId: company._id,
      version: importRow.version,
      logicalKey: importRow.logicalKey || "MOTOR_GRID",
      status: { $in: ["ACTIVE", "APPROVED", "DRAFT", "VALIDATED"] }
    }).sort({ createdAt: -1 });
    if (priorGrid) {
      priorGrid.status = "EXPIRED";
      await priorGrid.save();
    }
    if (importRow.replacesImportId) {
      await GridImport.findByIdAndUpdate(importRow.replacesImportId, { status: "REPLACED" });
    }
  }

  const grid = await CommissionGrid.create({
    insuranceCompanyId: company._id,
    name: `${company.name} ${importRow.version}`,
    version: importRow.version,
    logicalKey: importRow.logicalKey || "MOTOR_GRID",
    effectiveFrom: importRow.effectiveFrom,
    effectiveTo: importRow.effectiveTo,
    status: input.activate === false ? "VALIDATED" : "ACTIVE",
    source: {
      fileName: importRow.fileName,
      fileUrl: `/api/grid-import/${importRow._id}/download`,
      sheetNames: importRow.sheetNames
    },
    notes: `Created from GridImport ${importRow._id}`
  });

  if (parsed.rules.length) {
    await CommissionRule.insertMany(
      parsed.rules.map(rule => ({
        insuranceCompanyId: company._id,
        gridId: grid._id,
        ruleCode: rule.ruleCode,
        product: rule.product,
        priority: rule.priority,
        ruleKind: rule.ruleKind ?? "BASE",
        conditions: rule.conditions,
        result: rule.result,
        source: rule.source,
        active: true
      })),
      { ordered: false }
    );
  }

  if (parsed.rtoMappings.length) {
    await RtoMapping.insertMany(
      parsed.rtoMappings.map(mapping => ({
        insuranceCompanyId: company._id,
        gridId: grid._id,
        ...mapping
      })),
      { ordered: false }
    );
  }

  await GridImport.findByIdAndUpdate(importRow._id, {
    gridId: grid._id,
    status: "IMPORTED",
    rulesDetected: parsed.rules.length,
    rtoMappingsDetected: parsed.rtoMappings.length,
    rulesImported: parsed.rules.length,
    rtoMappingsImported: parsed.rtoMappings.length,
    warnings: parsed.warnings,
    errors: []
  });

  return {
    alreadyCommitted: false,
    importId: importRow._id,
    gridId: grid._id,
    company: { id: company._id, code: company.code, name: company.name },
    version: grid.version,
    logicalKey: grid.logicalKey,
    status: grid.status,
    rulesImported: parsed.rules.length,
    rtoMappingsImported: parsed.rtoMappings.length,
    warnings: parsed.warnings
  };
}

export async function listGridImports(query: {
  companyCode?: string;
  status?: string;
  version?: string;
}) {
  const filter: Record<string, any> = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.version) filter.version = String(query.version).toUpperCase();

  if (query.companyCode) {
    const company = await InsuranceCompany.findOne({
      code: canonicalCompanyCode(query.companyCode)
    }).lean();
    if (!company) return [];
    filter.insuranceCompanyId = company._id;
  }

  const rows = await GridImport.find(filter)
    .populate("insuranceCompanyId", "code name shortName active")
    .sort({ createdAt: -1 })
    .lean();

  return Promise.all(rows.map(async (row: any) => ({
    ...row,
    fileAvailable: await storedGridFileExists(row.storagePath)
  })));
}

export async function getGridImport(importId: string) {
  if (!mongoose.Types.ObjectId.isValid(importId)) throw new Error("Invalid importId");
  const row = await GridImport.findById(importId)
    .populate("insuranceCompanyId", "code name shortName active")
    .lean();
  if (!row) throw new Error("Grid import not found");
  return { ...row, fileAvailable: await storedGridFileExists(row.storagePath) };
}

export async function getGridImportDownload(importId: string) {
  if (!mongoose.Types.ObjectId.isValid(importId)) throw new Error("Invalid importId");
  const row = await GridImport.findById(importId).lean();
  if (!row) throw new Error("Grid import not found");
  if (!(await storedGridFileExists(row.storagePath))) throw new Error("Stored file not found");
  return row;
}

export async function deleteGridImport(importId: string, force = false) {
  if (!mongoose.Types.ObjectId.isValid(importId)) throw new Error("Invalid importId");
  const row = await GridImport.findById(importId);
  if (!row) throw new Error("Grid import not found");

  if (row.gridId) {
    const grid = await CommissionGrid.findById(row.gridId);
    if (grid && grid.status === "ACTIVE" && !force) {
      const error: any = new Error("This file is linked to an ACTIVE grid. Confirm force delete to remove the grid, rules, mappings and uploaded file.");
      error.statusCode = 409;
      error.requiresForce = true;
      throw error;
    }

    if (force) {
      await CommissionRule.deleteMany({ gridId: row.gridId });
      await RtoMapping.deleteMany({ gridId: row.gridId });
      await CommissionGrid.findByIdAndDelete(row.gridId);
    } else if (grid) {
      // Non-active committed grid: delete its generated data together with import.
      await CommissionRule.deleteMany({ gridId: row.gridId });
      await RtoMapping.deleteMany({ gridId: row.gridId });
      await CommissionGrid.findByIdAndDelete(row.gridId);
    }
  }

  const storagePath = row.storagePath;
  await GridImport.findByIdAndDelete(row._id);

  // Delete physical bytes only when no remaining import references them.
  const remainingReference = await GridImport.exists({ storagePath });
  if (!remainingReference) await deleteStoredGridFile(storagePath);

  return {
    deleted: true,
    importId: row._id,
    fileName: row.fileName,
    gridDeleted: Boolean(row.gridId),
    physicalFileDeleted: !remainingReference
  };
}
