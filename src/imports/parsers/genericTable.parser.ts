import { ExcelSheet } from "../excelReader";
import { GridImportResult, ImportedCondition } from "../types";
import {
  ageConditions,
  clean,
  excelColumn,
  moneySlabConditions,
  nopConditions,
  normalizePolicyType,
  rangeConditions,
  rule,
  slug,
  upper
} from "./helpers";

export interface GenericParserProfile {
  _id?: unknown;
  name: string;
  sheetName: string;
  headerRow: number;
  layout?: "ROW_TABLE";
  product: { mode: "CONSTANT" | "COLUMN"; value?: string; column?: string };
  result: {
    column: string;
    basis?: "OD" | "TP" | "NET" | "GROSS" | "GWP" | "OD_TP" | "FIXED";
    priority?: number;
    ruleKind?: "BASE" | "ADJUSTMENT" | "EXCLUSION";
  };
  conditions?: Array<{
    field: string;
    column: string;
    operator?: "EQUAL" | "IN" | "BETWEEN" | "GTE" | "GT" | "LTE" | "LT" | "EXISTS" | "RANGE";
    parser?: "TEXT" | "NUMBER" | "BOOLEAN" | "POLICY_TYPE" | "AGE_RANGE" | "GVW_RANGE" | "MONEY_SLAB" | "NOP_SLAB";
    skipIfEmpty?: boolean;
  }>;
}

function normHeader(v: unknown) {
  return upper(v).replace(/[^A-Z0-9]+/g, " ").trim();
}

function excelColumnIndex(s: string): number | null {
  const t = String(s || "").trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(t)) return null;
  let n = 0;
  for (const ch of t) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function findColumn(spec: string, header: unknown[]): number {
  const wanted = normHeader(spec);
  const byHeader = header.findIndex(h => normHeader(h) === wanted);
  if (byHeader >= 0) return byHeader;
  const direct = excelColumnIndex(spec);
  return direct !== null ? direct : -1;
}

function scalar(v: unknown, parser = "TEXT"): unknown {
  const s = clean(v);
  if (parser === "NUMBER") {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : s;
  }
  if (parser === "BOOLEAN") return /^(YES|TRUE|Y|1)$/i.test(s);
  if (parser === "POLICY_TYPE") return normalizePolicyType(s);
  return upper(s);
}

function parseCondition(field: string, operator: string, parser: string, v: unknown): ImportedCondition[] {
  const s = clean(v);
  if (!s) return [];
  if (parser === "AGE_RANGE") return ageConditions(v, field);
  if (parser === "GVW_RANGE") return rangeConditions(field, v);
  if (parser === "MONEY_SLAB") return moneySlabConditions(v, field);
  if (parser === "NOP_SLAB") return nopConditions(v, field);
  if (operator === "RANGE") return rangeConditions(field, v);

  const value = scalar(v, parser);
  if (operator === "IN") {
    const vals = s.split(/[;,|/]+/).map(x => scalar(x, parser)).filter(x => clean(x) !== "");
    return vals.length ? [{ field, operator: "IN", value: vals }] : [];
  }
  if (operator === "BETWEEN") {
    const nums = (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    return nums.length >= 2 ? [{ field, operator: "BETWEEN", value: [nums[0], nums[1]] }] : [];
  }
  if (operator === "EXISTS") return [{ field, operator: "EXISTS", value: true }];
  return [{ field, operator: operator as any, value }];
}

function normalizeProduct(v: unknown): string {
  const s = upper(v).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["PC", "PVT_CAR", "PRIVATE_CAR", "PRIVATECAR"].includes(s)) return "PRIVATE_CAR";
  if (["TW", "2W", "TWO_WHEELER", "TWOWHEELER"].includes(s)) return "TWO_WHEELER";
  if (s.includes("GCV")) return "GCV";
  if (s.includes("PCV")) return "PCV";
  return s || "ALL";
}

export function parseGenericTableWorkbook(
  insurerCode: string,
  sheets: ExcelSheet[],
  context: { fileName: string; version: string },
  profile: GenericParserProfile
): GridImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rules: GridImportResult["rules"] = [];
  const rtoMappings: GridImportResult["rtoMappings"] = [];

  if (profile.layout && profile.layout !== "ROW_TABLE") {
    errors.push(`Unsupported generic parser layout ${profile.layout}. Complex/matrix grids require a custom parser.`);
    return { insurerCode, fileName: context.fileName, rules, rtoMappings, warnings, errors };
  }

  const sheet = sheets.find(s => upper(s.name) === upper(profile.sheetName));
  if (!sheet) {
    errors.push(`Parser profile sheet '${profile.sheetName}' not found.`);
    return { insurerCode, fileName: context.fileName, rules, rtoMappings, warnings, errors };
  }

  const headerIndex = Math.max(0, Number(profile.headerRow || 1) - 1);
  const header = sheet.rows[headerIndex] || [];
  const resultCol = findColumn(profile.result.column, header);
  if (resultCol < 0) errors.push(`Result column '${profile.result.column}' was not found in ${sheet.name}.`);

  let productCol = -1;
  if (profile.product.mode === "COLUMN") {
    productCol = findColumn(profile.product.column || "", header);
    if (productCol < 0) errors.push(`Product column '${profile.product.column}' was not found in ${sheet.name}.`);
  }

  const compiledConditions = (profile.conditions || []).map(c => ({ ...c, col: findColumn(c.column, header) }));
  for (const c of compiledConditions) if (c.col < 0) errors.push(`Condition column '${c.column}' for field '${c.field}' was not found in ${sheet.name}.`);
  if (errors.length) return { insurerCode, fileName: context.fileName, rules, rtoMappings, warnings, errors };

  for (let r = headerIndex + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const rawResult = row[resultCol];
    if (!clean(rawResult)) continue;

    const product = normalizeProduct(profile.product.mode === "CONSTANT" ? profile.product.value : row[productCol]);
    const conditions: ImportedCondition[] = [];
    let skip = false;

    for (const c of compiledConditions) {
      const value = row[c.col];
      if (!clean(value)) {
        if (c.skipIfEmpty === false) { skip = true; break; }
        continue;
      }
      conditions.push(...parseCondition(c.field, c.operator || "EQUAL", c.parser || "TEXT", value));
    }
    if (skip) continue;

    const code = `GEN-${slug(insurerCode)}-${slug(context.version)}-${slug(profile.name)}-R${r + 1}`;
    const parsed = rule(
      context.fileName,
      sheet.name,
      r + 1,
      code,
      product,
      conditions,
      rawResult,
      profile.result.basis || "GWP",
      Number(profile.result.priority ?? 100),
      excelColumn(resultCol),
      profile.result.ruleKind || "BASE"
    );
    if (parsed) rules.push(parsed);
  }

  if (!rules.length) errors.push("Generic parser profile produced zero executable rules. Review sheet/header/column mapping before activation.");
  else warnings.push(`Generic parser profile '${profile.name}' generated ${rules.length} rules. Spot-check source rows before activation.`);

  return { insurerCode, fileName: context.fileName, rules, rtoMappings, warnings, errors };
}
