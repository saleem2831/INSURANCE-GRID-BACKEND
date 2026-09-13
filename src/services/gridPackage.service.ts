import crypto from "crypto";
import path from "path";
import mongoose from "mongoose";
import InsuranceCompany from "../models/InsuranceCompany";
import GridPackage from "../models/GridPackage";
import GridDocument, { GRID_DOCUMENT_ROLES } from "../models/GridDocument";
import CommissionGrid from "../models/CommissionGrid";
import CommissionRule from "../models/CommissionRule";
import RtoMapping from "../models/RtoMapping";
import GridImport from "../models/GridImport";
import GridIR from "../models/GridIR";
import { calculateFileHash } from "../imports/fileHash";
import { readExcelBuffer, ExcelSheet } from "../imports/excelReader";
import { parseWithStrategy } from "../imports/parserStrategy";
import { parseAuxiliaryRtoMappings } from "../imports/parsers/auxiliaryMapping.parser";
import { classifyGridDocument, GridDocumentRole } from "../packages/documentClassifier";
import {
  deleteStoredGridFile,
  persistGridFile,
  readStoredGridFile,
  storedGridFileExists
} from "../storage/gridFileStorage";
import { ImportedRule, ImportedRtoMapping } from "../imports/types";
import { extractPdfText } from "../imports/pdfReader";
import { parsePdfForCompany, tryGetPdfParserForCompany } from "../imports/pdfParserRegistry";
import { canonicalCompanyCode } from "../config/insurers";
import { mapWithConcurrency } from "../utils/asyncPool";

export interface PackageUploadFile {
  originalname: string;
  size: number;
  buffer: Buffer;
  relativePath?: string;
}

export interface PackageDocumentOverride {
  fileName?: string;
  relativePath?: string;
  role?: GridDocumentRole;
  productScope?: string[];
  required?: boolean;
  parserProfileId?: string;
}

interface PackageSelector {
  insuranceCompanyId?: string;
  companyCode?: string;
  companyName?: string;
}

interface PreviewPackageInput extends PackageSelector {
  version: string;
  effectiveFrom: string;
  effectiveTo?: string;
  name?: string;
  sourceType?: "SINGLE_FILE" | "MULTI_FILE" | "COMPANY_FOLDER";
  files: PackageUploadFile[];
  overrides?: PackageDocumentOverride[];
}

type TaggedRule = ImportedRule & { __documentId: any; __documentRole: string };
type TaggedMapping = ImportedRtoMapping & { __documentId: any; __documentRole: string };

function normalizeCode(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

async function resolveCompany(input: PackageSelector) {
  if (input.insuranceCompanyId) {
    if (!mongoose.Types.ObjectId.isValid(input.insuranceCompanyId)) throw new Error("Invalid insuranceCompanyId");
    const company = await InsuranceCompany.findById(input.insuranceCompanyId);
    if (!company) throw new Error("Insurance company not found");
    return company;
  }
  const code = canonicalCompanyCode(input.companyCode);
  const name = String(input.companyName ?? "").trim();
  if (!code) throw new Error("companyCode or insuranceCompanyId is required");
  let company = await InsuranceCompany.findOne({ code });
  if (!company) {
    if (!name) throw new Error("companyName is required for a new insurance company");
    company = await InsuranceCompany.create({ code, name, shortName: name, active: true });
  }
  return company;
}

function parseDates(fromRaw: string, toRaw?: string) {
  const effectiveFrom = new Date(fromRaw);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Invalid effectiveFrom date");
  let effectiveTo: Date | null = null;
  if (toRaw) {
    effectiveTo = new Date(toRaw);
    if (Number.isNaN(effectiveTo.getTime())) throw new Error("Invalid effectiveTo date");
    if (effectiveTo < effectiveFrom) throw new Error("effectiveTo cannot be before effectiveFrom");
  }
  return { effectiveFrom, effectiveTo };
}

function packageHash(fileHashes: string[]) {
  return crypto.createHash("sha256").update([...fileHashes].sort().join("|"), "utf8").digest("hex");
}

function fileType(fileName: string): string {
  return path.extname(fileName).replace(".", "").toUpperCase() || "UNKNOWN";
}

function isExcelDocument(fileName: string) {
  return [".xlsx", ".xls", ".xlsb"].includes(path.extname(fileName).toLowerCase());
}

function rolePriority(role: string) {
  switch (role) {
    case "CLUSTER_MASTER": return 100;
    case "RTO_MASTER": return 90;
    case "LOOKUP_MASTER": return 80;
    case "PRODUCT_GRID": return 60;
    case "PAYOUT_GRID": return 50;
    default: return 40;
  }
}

function isExecutableRole(role: string) {
  return ["PAYOUT_GRID", "PRODUCT_GRID", "INCREMENTAL_GRID", "EXCLUSION_GRID"].includes(role);
}

function isMappingRole(role: string) {
  return ["RTO_MASTER", "CLUSTER_MASTER", "LOOKUP_MASTER"].includes(role);
}

function overrideFor(file: PackageUploadFile, overrides: PackageDocumentOverride[]) {
  const rel = String(file.relativePath || "");
  const name = String(file.originalname || "");
  return overrides.find(x =>
    (x.relativePath && x.relativePath === rel) ||
    (x.fileName && x.fileName === name) ||
    (x.fileName && path.basename(rel) === x.fileName)
  );
}

function docKey(doc: any): string {
  return String(doc._id).slice(-8).toUpperCase();
}

function tagRule(rule: ImportedRule, doc: any): TaggedRule {
  return {
    ...rule,
    ruleCode: `${docKey(doc)}-${rule.ruleCode}`,
    source: { ...rule.source, fileName: rule.source?.fileName || doc.fileName },
    __documentId: doc._id,
    __documentRole: doc.role
  };
}

function tagMapping(mapping: ImportedRtoMapping, doc: any): TaggedMapping {
  return {
    ...mapping,
    source: { ...mapping.source, fileName: mapping.source?.fileName || doc.fileName },
    metadata: { ...(mapping.metadata || {}), documentRole: doc.role },
    __documentId: doc._id,
    __documentRole: doc.role
  };
}

function dedupeMappings(rows: TaggedMapping[]) {
  const selected = new Map<string, TaggedMapping>();
  for (const m of rows) {
    const key = `${m.rtoCode}|${m.product}|${m.mappingClass || ""}`;
    const current = selected.get(key);
    if (!current || rolePriority(m.__documentRole) > rolePriority(current.__documentRole)) {
      selected.set(key, m);
    }
  }
  return [...selected.values()];
}

async function inspectSheets(buffer: Buffer, fileName: string): Promise<ExcelSheet[]> {
  if (!isExcelDocument(fileName)) return [];
  return readExcelBuffer(buffer);
}

async function parseOneDocument(company: any, doc: any, buffer: Buffer, version: string) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rules: TaggedRule[] = [];
  const mappings: TaggedMapping[] = [];
  const sheets = await inspectSheets(buffer, doc.fileName);
  let parserName = "REFERENCE_ONLY";
  const ext = path.extname(doc.fileName).toLowerCase();

  if (ext === ".pdf") {
    if (doc.role === "REFERENCE_DOCUMENT") {
      warnings.push(`${doc.fileName} is reference-only and does not participate in payout calculation.`);
      return { parserName, sheets, rules, mappings, warnings, errors, reviewRequired: false, ir: null as any };
    }
    const extraction = await extractPdfText(buffer, doc.fileName);
    warnings.push(...extraction.warnings);
    parserName = tryGetPdfParserForCompany(company.code) || "PARSER_REQUIRED";
    const parsed = parsePdfForCompany(company.code, extraction.pages, { fileName: doc.fileName, version });
    rules.push(...parsed.rules.map(x => tagRule(x, doc)));
    mappings.push(...parsed.rtoMappings.map(x => tagMapping(x, doc)));
    warnings.push(...parsed.warnings);
    errors.push(...parsed.errors);
    if (doc.required && isExecutableRole(doc.role) && !rules.length && !mappings.length && !errors.length) {
      errors.push(`Required PDF ${doc.fileName} produced no deterministic rules or mappings.`);
    }
    return {
      parserName: `PDF:${parserName}:${extraction.extractor}`,
      sheets,
      rules,
      mappings,
      warnings,
      errors,
      reviewRequired: errors.length > 0,
      ir: {
        sourceType: "PDF",
        extractor: extraction.extractor,
        textAvailable: extraction.pages.some(p => p.text.trim().length > 0),
        ocrUsed: extraction.ocrUsed,
        pageCount: extraction.pages.length,
        pages: extraction.pages.map(p => ({ page: p.page, text: p.text.slice(0, 20000) })),
        sheets: [],
        warnings: extraction.warnings
      }
    };
  }

  if (!isExcelDocument(doc.fileName)) {
    warnings.push(`${doc.fileName} is retained for source/reference; executable parsing is not configured for ${doc.fileType}.`);
    return { parserName, sheets, rules, mappings, warnings, errors, reviewRequired: false, ir: null as any };
  }

  const ir = {
    sourceType: ext === ".xlsb" ? "XLSB" : "EXCEL",
    extractor: "SHEETJS",
    textAvailable: true,
    ocrUsed: false,
    pageCount: 0,
    pages: [],
    sheets: sheets.map(s => ({ name: s.name, rowCount: s.rows.length })),
    warnings: []
  };

  if (isMappingRole(doc.role)) {
    parserName = "AUXILIARY_RTO_MAPPING";
    const parsed = parseAuxiliaryRtoMappings(sheets, { fileName: doc.fileName, productScope: doc.productScope || [] });
    mappings.push(...parsed.mappings.map(x => tagMapping(x, doc)));
    warnings.push(...parsed.warnings);
    errors.push(...parsed.errors);
    if (doc.required && !parsed.mappings.length) errors.push(`Required mapping document ${doc.fileName} produced zero deterministic RTO mappings.`);
    return { parserName, sheets, rules, mappings, warnings, errors, reviewRequired: false, ir };
  }

  if (doc.role === "REFERENCE_DOCUMENT") {
    warnings.push(`${doc.fileName} is reference-only and does not participate in payout calculation.`);
    return { parserName, sheets, rules, mappings, warnings, errors, reviewRequired: false, ir };
  }

  const strategy = await parseWithStrategy(company, sheets, { fileName: doc.fileName, version }, doc.parserProfileId ? String(doc.parserProfileId) : null);
  parserName = strategy.parserName;
  const parsed = strategy.parsed;
  rules.push(...parsed.rules.map(x => tagRule(x, doc)));
  mappings.push(...parsed.rtoMappings.map(x => tagMapping(x, doc)));
  warnings.push(...parsed.warnings);
  if (isExecutableRole(doc.role)) errors.push(...parsed.errors);
  else if (parsed.errors.length) warnings.push(...parsed.errors.map((x: string) => `Supporting document: ${x}`));
  if (doc.required && isExecutableRole(doc.role) && !rules.length && !mappings.length) {
    errors.push(`Required executable document ${doc.fileName} produced no rules or mappings.`);
  }
  return { parserName, sheets, rules, mappings, warnings, errors, reviewRequired: false, ir };
}

async function validateAndPersistPackage(packageId: string) {
  const pkg: any = await GridPackage.findById(packageId);
  if (!pkg) throw new Error("Grid package not found");
  const company = await InsuranceCompany.findById(pkg.insuranceCompanyId);
  if (!company) throw new Error("Insurance company not found");
  const docs: any[] = await GridDocument.find({ packageId: pkg._id }).sort({ createdAt: 1 });
  if (!docs.length) throw new Error("Package has no documents");

  pkg.status = "VALIDATING";
  await pkg.save();

  const allRules: TaggedRule[] = [];
  const allMappings: TaggedMapping[] = [];
  const packageWarnings: string[] = [];
  const packageErrors: string[] = [];

  const parseConcurrency = Math.max(1, Math.min(6, Number(process.env.PACKAGE_PARSE_CONCURRENCY || 3)));
  const parsedDocs = await mapWithConcurrency(docs, parseConcurrency, async (doc: any) => {
    try {
      if (!(await storedGridFileExists(doc.storagePath))) throw new Error(`Stored file missing: ${doc.fileName}`);
      const buffer = await readStoredGridFile(doc.storagePath);
      const parsed = await parseOneDocument(company, doc, buffer, pkg.version);
      if (parsed.ir) {
        await GridIR.findOneAndUpdate(
          { documentId: doc._id },
          {
            packageId: pkg._id,
            documentId: doc._id,
            insuranceCompanyId: company._id,
            ...parsed.ir,
            metadata: { fileName: doc.fileName, role: doc.role, productScope: doc.productScope || [] }
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
      }

      doc.parser = parsed.parserName;
      doc.sheetNames = parsed.sheets.map((s: ExcelSheet) => s.name);
      doc.rulesDetected = parsed.rules.length;
      doc.rtoMappingsDetected = parsed.mappings.length;
      doc.warnings = parsed.warnings;
      doc.errors = parsed.errors;
      doc.status = parsed.errors.length ? "FAILED" : parsed.reviewRequired ? "REVIEW_REQUIRED" : "VALIDATED";
      doc.preview = {
        sheets: parsed.sheets.map((s: ExcelSheet) => ({ name: s.name, rowCount: s.rows.length })),
        rules: parsed.rules.slice(0, 5).map((r: any) => ({ ruleCode: r.ruleCode, product: r.product, conditions: r.conditions, result: r.result, source: r.source })),
        mappings: parsed.mappings.slice(0, 5).map((m: any) => ({ rtoCode: m.rtoCode, product: m.product, cluster: m.cluster, source: m.source }))
      };
      await doc.save();
      return { doc, parsed, error: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document parsing failed";
      doc.status = "FAILED";
      doc.errors = [message];
      await doc.save();
      return { doc, parsed: null as any, error: message };
    }
  });

  // Aggregate in original document order so rule ordering/source audit is deterministic
  // even though extraction/parsing ran concurrently.
  for (const item of parsedDocs) {
    const { doc, parsed, error } = item;
    if (error) {
      if (doc.required) packageErrors.push(`${doc.fileName}: ${error}`);
      else packageWarnings.push(`${doc.fileName}: ${error}`);
      continue;
    }
    allRules.push(...parsed.rules);
    allMappings.push(...parsed.mappings);
    packageWarnings.push(...parsed.warnings.map((w: string) => `${doc.fileName}: ${w}`));
    packageErrors.push(...parsed.errors.map((e: string) => `${doc.fileName}: ${e}`));
  }

  const mappings = dedupeMappings(allMappings);
  const productCoverage = [...new Set(allRules.map(r => r.product).filter(x => x && x !== "ALL"))].sort();
  if (!allRules.length) packageErrors.push("Package produced zero executable commission rules.");

  pkg.totalDocuments = docs.length;
  pkg.totalRules = allRules.length;
  pkg.totalRtoMappings = mappings.length;
  pkg.productCoverage = productCoverage;
  pkg.warnings = packageWarnings;
  pkg.errors = packageErrors;
  pkg.validationSummary = {
    documents: docs.length,
    validatedDocuments: docs.filter(d => d.status === "VALIDATED").length,
    reviewDocuments: docs.filter(d => d.status === "REVIEW_REQUIRED").length,
    failedDocuments: docs.filter(d => d.status === "FAILED").length,
    rules: allRules.length,
    rtoMappings: mappings.length,
    productCoverage
  };
  pkg.status = packageErrors.length ? "FAILED" : "VALIDATED";
  await pkg.save();

  return { pkg, docs, rules: allRules, mappings, warnings: packageWarnings, errors: packageErrors };
}

export async function previewGridPackage(input: PreviewPackageInput) {
  if (!input.files?.length) throw new Error("At least one company grid document is required");
  if (input.files.length > 50) throw new Error("A package can contain at most 50 documents");
  const company = await resolveCompany(input);
  const version = normalizeCode(input.version);
  if (!version) throw new Error("version is required");
  const { effectiveFrom, effectiveTo } = parseDates(input.effectiveFrom, input.effectiveTo);

  const hashes = input.files.map(f => calculateFileHash(f.buffer));
  const pHash = packageHash(hashes);
  const exact = await GridPackage.findOne({ insuranceCompanyId: company._id, version, packageHash: pHash, status: { $ne: "FAILED" } }).lean();
  if (exact) {
    return {
      duplicate: true,
      action: "DUPLICATE",
      packageId: exact._id,
      message: "PACKAGE EXISTS: the same company/version and exact document set has already been uploaded."
    };
  }
  const previous = await GridPackage.findOne({ insuranceCompanyId: company._id, version, status: { $ne: "FAILED" } }).sort({ createdAt: -1 }).lean();
  const action = previous ? "REPLACE" : "CREATE";

  const pkg: any = await GridPackage.create({
    insuranceCompanyId: company._id,
    name: input.name || `${company.name} ${version}`,
    packageHash: pHash,
    action,
    replacesPackageId: previous?._id || null,
    version,
    effectiveFrom,
    effectiveTo,
    status: "DRAFT",
    sourceType: input.sourceType || (input.files.length === 1 ? "SINGLE_FILE" : "COMPANY_FOLDER"),
    totalDocuments: input.files.length,
    warnings: action === "REPLACE" ? [`A previous ${company.code} ${version} package exists. This package is a revision candidate; the existing ACTIVE package remains live until this one is activated.`] : []
  });

  const overrides = input.overrides || [];
  try {
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const hash = hashes[i];
      let sheets: ExcelSheet[] = [];
      try { sheets = await inspectSheets(file.buffer, file.originalname); } catch { /* validation reports later */ }
      let auto = classifyGridDocument(file.originalname, sheets);
      const over = overrideFor(file, overrides);
      if (path.extname(file.originalname).toLowerCase() === ".pdf" && tryGetPdfParserForCompany(company.code)) {
        auto = { ...auto, role: "PAYOUT_GRID", required: true, confidence: "HIGH", reason: `Executable PDF parser available for ${canonicalCompanyCode(company.code)}.` };
      }
      const role = over?.role && (GRID_DOCUMENT_ROLES as readonly string[]).includes(over.role) ? over.role : auto.role;
      const productScope = over?.productScope?.length ? over.productScope.map(normalizeCode) : auto.productScope;
      const required = typeof over?.required === "boolean" ? over.required : auto.required;
      const persisted = await persistGridFile(file.buffer, file.originalname, hash);
      await GridDocument.create({
        packageId: pkg._id,
        insuranceCompanyId: company._id,
        fileName: path.basename(file.originalname),
        relativePath: file.relativePath || file.originalname,
        fileHash: hash,
        fileSize: file.size,
        storagePath: persisted.storagePath,
        fileType: fileType(file.originalname),
        role,
        productScope,
        required,
        parserProfileId: over?.parserProfileId || null,
        status: "STORED",
        sheetNames: sheets.map(s => s.name),
        warnings: [`Auto classification: ${auto.reason}${over ? " (user override applied where supplied)" : ""}`]
      });
    }
    const validation = await validateAndPersistPackage(String(pkg._id));
    return packageResponse(validation.pkg, validation.docs, { duplicate: false, action });
  } catch (error) {
    await GridPackage.findByIdAndUpdate(pkg._id, { status: "FAILED", errors: [error instanceof Error ? error.message : "Package preview failed"] });
    throw error;
  }
}

function packageResponse(pkg: any, docs: any[], extra: Record<string, any> = {}) {
  return {
    ...extra,
    packageId: pkg._id,
    companyId: pkg.insuranceCompanyId,
    name: pkg.name,
    version: pkg.version,
    status: pkg.status,
    effectiveFrom: pkg.effectiveFrom,
    effectiveTo: pkg.effectiveTo,
    sourceType: pkg.sourceType,
    totalDocuments: pkg.totalDocuments,
    totalRules: pkg.totalRules,
    totalRtoMappings: pkg.totalRtoMappings,
    productCoverage: pkg.productCoverage,
    warnings: pkg.warnings,
    errors: pkg.errors,
    validationSummary: pkg.validationSummary,
    canCommit: pkg.status === "VALIDATED" && !(pkg.errors || []).length,
    documents: docs.map((d: any) => ({
      id: d._id,
      fileName: d.fileName,
      relativePath: d.relativePath,
      fileType: d.fileType,
      role: d.role,
      productScope: d.productScope,
      required: d.required,
      parser: d.parser,
      parserProfileId: d.parserProfileId,
      status: d.status,
      sheetNames: d.sheetNames,
      rulesDetected: d.rulesDetected,
      rtoMappingsDetected: d.rtoMappingsDetected,
      warnings: d.warnings,
      errors: d.errors,
      preview: d.preview
    }))
  };
}

export async function revalidateGridPackage(packageId: string) {
  if (!mongoose.Types.ObjectId.isValid(packageId)) throw new Error("Invalid packageId");
  const current = await GridPackage.findById(packageId).lean();
  if (!current) throw new Error("Grid package not found");
  if (current.status === "ACTIVE") throw new Error("ACTIVE packages are immutable. Create a replacement package to change documents or roles.");
  const validation = await validateAndPersistPackage(packageId);
  return packageResponse(validation.pkg, validation.docs);
}

export async function updateGridDocument(
  packageId: string,
  documentId: string,
  patch: { role?: string; productScope?: string[]; required?: boolean; parserProfileId?: string | null }
) {
  if (!mongoose.Types.ObjectId.isValid(packageId) || !mongoose.Types.ObjectId.isValid(documentId)) throw new Error("Invalid package/document id");
  const pkg = await GridPackage.findById(packageId);
  if (!pkg) throw new Error("Grid package not found");
  if (pkg.status === "ACTIVE") throw new Error("ACTIVE package document roles cannot be edited. Create a replacement package instead.");
  const doc: any = await GridDocument.findOne({ _id: documentId, packageId });
  if (!doc) throw new Error("Grid document not found");
  if (patch.role !== undefined) {
    const role = normalizeCode(patch.role);
    if (!(GRID_DOCUMENT_ROLES as readonly string[]).includes(role)) throw new Error("Invalid document role");
    doc.role = role;
  }
  if (patch.productScope !== undefined) doc.productScope = patch.productScope.map(normalizeCode).filter(Boolean);
  if (typeof patch.required === "boolean") doc.required = patch.required;
  if (patch.parserProfileId !== undefined) doc.parserProfileId = patch.parserProfileId || null;
  doc.status = "STORED";
  await doc.save();
  pkg.status = "DRAFT";
  await pkg.save();
  return revalidateGridPackage(packageId);
}

function overlapQuery(pkg: any): any {
  const end = pkg.effectiveTo || new Date("9999-12-31T23:59:59.999Z");
  return {
    insuranceCompanyId: pkg.insuranceCompanyId,
    status: "ACTIVE",
    _id: { $ne: pkg._id },
    effectiveFrom: { $lte: end },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: pkg.effectiveFrom } }]
  };
}

export async function commitGridPackage(packageId: string, activate = true) {
  if (!mongoose.Types.ObjectId.isValid(packageId)) throw new Error("Invalid packageId");
  let pkg: any = await GridPackage.findById(packageId);
  if (!pkg) throw new Error("Grid package not found");
  if (pkg.gridId) {
    if (activate && pkg.status === "VALIDATED") {
      const oldPackages: any[] = await GridPackage.find(overlapQuery(pkg));
      for (const old of oldPackages) {
        old.status = "EXPIRED";
        await old.save();
        if (old.gridId) await CommissionGrid.findByIdAndUpdate(old.gridId, { status: "EXPIRED" });
      }
      await CommissionGrid.findByIdAndUpdate(pkg.gridId, { status: "ACTIVE" });
      pkg.status = "ACTIVE";
      await pkg.save();
      return { alreadyCommitted: true, activated: true, packageId: pkg._id, gridId: pkg.gridId, status: pkg.status };
    }
    return { alreadyCommitted: true, activated: pkg.status === "ACTIVE", packageId: pkg._id, gridId: pkg.gridId, status: pkg.status };
  }

  const validation = await validateAndPersistPackage(packageId);
  pkg = validation.pkg;
  if (validation.errors.length || pkg.status !== "VALIDATED") {
    throw new Error(`Package commit blocked: ${validation.errors.join("; ") || "package is not validated"}`);
  }
  const company = await InsuranceCompany.findById(pkg.insuranceCompanyId);
  if (!company) throw new Error("Insurance company not found");

  let grid: any = null;
  try {
    if (activate) {
      const oldPackages: any[] = await GridPackage.find(overlapQuery(pkg));
      for (const old of oldPackages) {
        old.status = "EXPIRED";
        await old.save();
        if (old.gridId) await CommissionGrid.findByIdAndUpdate(old.gridId, { status: "EXPIRED" });
      }
    }

    grid = await CommissionGrid.create({
      insuranceCompanyId: company._id,
      packageId: pkg._id,
      name: `${company.name} ${pkg.version} Package`,
      version: pkg.version,
      logicalKey: "COMPANY_PACKAGE",
      effectiveFrom: pkg.effectiveFrom,
      effectiveTo: pkg.effectiveTo,
      status: activate ? "ACTIVE" : "VALIDATED",
      source: {
        fileName: `${company.code}-${pkg.version}-PACKAGE`,
        fileUrl: `/api/grid-packages/${pkg._id}`,
        sheetNames: []
      },
      notes: `V6 company package ${pkg._id}; ${validation.docs.length} source documents.`
    });

    if (validation.rules.length) {
      await CommissionRule.insertMany(validation.rules.map((r: any) => ({
        insuranceCompanyId: company._id,
        gridId: grid._id,
        packageId: pkg._id,
        documentId: r.__documentId,
        ruleCode: r.ruleCode,
        product: r.product,
        priority: r.priority,
        ruleKind: r.ruleKind ?? "BASE",
        ruleGroup: r.ruleGroup ?? null,
        conditions: r.conditions,
        result: r.result,
        source: r.source,
        active: true
      })), { ordered: false });
    }
    if (validation.mappings.length) {
      await RtoMapping.insertMany(validation.mappings.map((m: any) => ({
        insuranceCompanyId: company._id,
        gridId: grid._id,
        packageId: pkg._id,
        documentId: m.__documentId,
        rtoCode: m.rtoCode,
        originalRtoCode: m.originalRtoCode,
        product: m.product,
        cluster: m.cluster,
        region: m.region,
        state: m.state,
        location: m.location,
        subCluster: m.subCluster,
        actuarialCluster: m.actuarialCluster,
        mappingClass: m.mappingClass,
        metadata: m.metadata,
        source: m.source
      })), { ordered: false });
    }

    await GridDocument.updateMany({ packageId: pkg._id, status: "VALIDATED" }, { status: "IMPORTED" });
    pkg.gridId = grid._id;
    pkg.status = activate ? "ACTIVE" : "VALIDATED";
    pkg.totalRules = validation.rules.length;
    pkg.totalRtoMappings = validation.mappings.length;
    await pkg.save();
    if (pkg.replacesPackageId) {
      const old = await GridPackage.findById(pkg.replacesPackageId);
      if (old && old.status !== "ACTIVE") old.status = "EXPIRED", await old.save();
    }
    return {
      alreadyCommitted: false,
      packageId: pkg._id,
      gridId: grid._id,
      status: pkg.status,
      company: { id: company._id, code: company.code, name: company.name },
      version: pkg.version,
      documentsImported: validation.docs.length,
      rulesImported: validation.rules.length,
      rtoMappingsImported: validation.mappings.length,
      productCoverage: pkg.productCoverage,
      warnings: pkg.warnings
    };
  } catch (error) {
    if (grid?._id) {
      await CommissionRule.deleteMany({ gridId: grid._id });
      await RtoMapping.deleteMany({ gridId: grid._id });
      await CommissionGrid.findByIdAndDelete(grid._id);
    }
    throw error;
  }
}

export async function listGridPackages(query: { companyCode?: string; status?: string; version?: string }) {
  const filter: any = {};
  if (query.status) filter.status = normalizeCode(query.status);
  if (query.version) filter.version = normalizeCode(query.version);
  if (query.companyCode) {
    const company = await InsuranceCompany.findOne({ code: canonicalCompanyCode(query.companyCode) }).lean();
    if (!company) return [];
    filter.insuranceCompanyId = company._id;
  }
  const rows: any[] = await GridPackage.find(filter).populate("insuranceCompanyId", "code name shortName active").sort({ createdAt: -1 }).lean();
  return Promise.all(rows.map(async row => ({
    ...row,
    documents: await GridDocument.find({ packageId: row._id }).select("fileName relativePath fileType role productScope required status rulesDetected rtoMappingsDetected").sort({ createdAt: 1 }).lean()
  })));
}

export async function getGridPackage(packageId: string) {
  if (!mongoose.Types.ObjectId.isValid(packageId)) throw new Error("Invalid packageId");
  const pkg: any = await GridPackage.findById(packageId).populate("insuranceCompanyId", "code name shortName active").lean();
  if (!pkg) throw new Error("Grid package not found");
  const docs: any[] = await GridDocument.find({ packageId }).sort({ createdAt: 1 }).lean();
  return packageResponse(pkg, docs);
}

export async function getGridDocumentDownload(packageId: string, documentId: string) {
  if (!mongoose.Types.ObjectId.isValid(packageId) || !mongoose.Types.ObjectId.isValid(documentId)) throw new Error("Invalid package/document id");
  const doc: any = await GridDocument.findOne({ _id: documentId, packageId }).lean();
  if (!doc) throw new Error("Grid document not found");
  if (!(await storedGridFileExists(doc.storagePath))) throw new Error("Stored document not found");
  return doc;
}

export async function deleteGridPackage(packageId: string, force = false) {
  if (!mongoose.Types.ObjectId.isValid(packageId)) throw new Error("Invalid packageId");
  const pkg: any = await GridPackage.findById(packageId);
  if (!pkg) throw new Error("Grid package not found");
  if (pkg.status === "ACTIVE" && !force) {
    const e: any = new Error("This package is ACTIVE. Confirm force delete to remove its grid, rules, mappings and documents.");
    e.statusCode = 409;
    e.requiresForce = true;
    throw e;
  }
  if (pkg.gridId) {
    await CommissionRule.deleteMany({ gridId: pkg.gridId });
    await RtoMapping.deleteMany({ gridId: pkg.gridId });
    await CommissionGrid.findByIdAndDelete(pkg.gridId);
  }
  const docs: any[] = await GridDocument.find({ packageId: pkg._id });
  await GridIR.deleteMany({ packageId: pkg._id });
  await GridDocument.deleteMany({ packageId: pkg._id });
  await GridPackage.findByIdAndDelete(pkg._id);
  let deletedFiles = 0;
  for (const doc of docs) {
    const [otherDoc, legacy] = await Promise.all([
      GridDocument.exists({ storagePath: doc.storagePath }),
      GridImport.exists({ storagePath: doc.storagePath })
    ]);
    if (!otherDoc && !legacy) {
      await deleteStoredGridFile(doc.storagePath);
      deletedFiles++;
    }
  }
  return { deleted: true, packageId: pkg._id, gridDeleted: Boolean(pkg.gridId), documentsDeleted: docs.length, physicalFilesDeleted: deletedFiles };
}
