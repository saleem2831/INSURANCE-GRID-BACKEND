import { ExcelSheet } from "../excelReader";
import {
  GridImportResult,
  ImportedCondition,
  ImportedRule,
  ImportedRtoMapping
} from "../types";
import { normalizeRto } from "./helpers";

export interface MagmaParseContext {
  fileName: string;
  version: string;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function upper(value: unknown): string {
  return clean(value).toUpperCase();
}

function slug(value: unknown): string {
  return upper(value)
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function numberOrNull(value: unknown): number | null {
  const text = clean(value).replace(/%/g, "").replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMagmaProduct(value: unknown): string {
  const text = upper(value);
  if (!text) return "";
  if (text.includes("PVT CAR") || text.includes("PRIVATE CAR")) return "PRIVATE_CAR";
  if (text.includes("2W") || text.includes("TWO WHEELER")) return "TWO_WHEELER";
  if (text.includes("GCV")) return "GCV";
  if (text.includes("PCV")) return "PCV";
  if (text.includes("TRACTOR")) return "TRACTOR";
  if (text === "CE" || text.includes("CONSTRUCTION") || text.includes("MISC-D") || text.includes("MISD")) return "CE";
  if (text.includes("HARVESTER")) return "HARVESTER";
  return text.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function slabConditions(sheetName: string): ImportedCondition[] | null {
  const name = upper(sheetName).replace(/\s+/g, " ");
  if (name.includes("> 8") || name.includes(">8")) {
    return [{ field: "businessMetrics.monthlyGwp", operator: "GT", value: 800000 }];
  }
  if (name.includes(">5") && name.includes("<=8")) {
    return [
      { field: "businessMetrics.monthlyGwp", operator: "GT", value: 500000 },
      { field: "businessMetrics.monthlyGwp", operator: "LTE", value: 800000 }
    ];
  }
  if (name.includes(">3") && name.includes("<=5")) {
    return [
      { field: "businessMetrics.monthlyGwp", operator: "GT", value: 300000 },
      { field: "businessMetrics.monthlyGwp", operator: "LTE", value: 500000 }
    ];
  }
  if (name.includes("<=3") || name.includes("< =3")) {
    return [{ field: "businessMetrics.monthlyGwp", operator: "LTE", value: 300000 }];
  }
  return null;
}

function parsePayout(value: unknown) {
  const text = upper(value);
  if (!text) return null;
  if (text === "IRDA") return { type: "IRDA" as const };
  if (text.includes("NO BIZ") || text.includes("NO BUSINESS")) {
    return { type: "NO_BUSINESS" as const };
  }
  if (text.includes("DECLINE") || text.includes("BLOCK")) {
    return { type: "DECLINE" as const };
  }
  if (text === "CC" || text.includes("COUNCIL CALL")) {
    return { type: "COUNCIL_CALL" as const };
  }
  const percentage = numberOrNull(value);
  if (percentage !== null) {
    return { type: "PAYOUT" as const, percentage, basis: "GWP" as const };
  }
  return {
    type: "MANUAL_REVIEW" as const,
    reason: `Unrecognized Magma payout value: ${clean(value)}`
  };
}

function parseRange(text: string, unit: "GVW" | "CC"): ImportedCondition[] {
  const t = upper(text).replace(/,/g, "");
  const field = unit === "GVW" ? "gvw" : "cc";
  const multiplier = unit === "GVW" ? 1000 : 1;

  let m = t.match(/<=\s*([0-9.]+)\s*T/);
  if (m) return [{ field, operator: "LTE", value: Number(m[1]) * multiplier }];
  m = t.match(/>\s*([0-9.]+)\s*T/);
  if (m) return [{ field, operator: "GT", value: Number(m[1]) * multiplier }];
  m = t.match(/([0-9.]+)\s*T?\s*-\s*([0-9.]+)\s*T/);
  if (m) return [{ field, operator: "BETWEEN", value: [Number(m[1]) * multiplier, Number(m[2]) * multiplier] }];

  if (unit === "CC") {
    m = t.match(/^<\s*([0-9.]+)\s*CC/);
    if (m) return [{ field, operator: "LT", value: Number(m[1]) }];
    m = t.match(/^>\s*([0-9.]+)\s*CC/);
    if (m) return [{ field, operator: "GT", value: Number(m[1]) }];
    m = t.match(/^([0-9.]+)\s*-\s*([0-9.]+)\s*CC/);
    if (m) return [{ field, operator: "BETWEEN", value: [Number(m[1]), Number(m[2])] }];
  }
  return [];
}

function columnConditions(bizMixRaw: unknown, budgetMixRaw: unknown): {
  product: string;
  conditions: ImportedCondition[];
} {
  const bizMix = clean(bizMixRaw);
  const budgetMix = clean(budgetMixRaw);
  const b = upper(bizMix);
  const d = upper(budgetMix);
  const product = normalizeMagmaProduct(bizMix || budgetMix);
  const conditions: ImportedCondition[] = [];

  if (product === "GCV") {
    conditions.push(...parseRange(d || b, "GVW"));
    if (d.includes("AGE<5")) conditions.push({ field: "vehicleAge", operator: "LT", value: 5 });
    if (d.includes("AGE>=5")) conditions.push({ field: "vehicleAge", operator: "GTE", value: 5 });
    if (d.includes("3W") || b.includes("3W")) conditions.push({ field: "vehicleType", operator: "EQUAL", value: "3W" });
  }

  if (product === "PCV") {
    if (d.includes("3W") || b.includes("3W")) conditions.push({ field: "vehicleCategory", operator: "EQUAL", value: "3W" });
    if (d.includes("ELECTRIC")) conditions.push({ field: "fuelType", operator: "EQUAL", value: "ELECTRIC" });
    if (d.includes("NEW")) conditions.push({ field: "vehicleAge", operator: "LTE", value: 1 });
    if (d.includes("OLD")) conditions.push({ field: "vehicleAge", operator: "GT", value: 1 });
    if (d.includes("BUS")) conditions.push({ field: "vehicleCategory", operator: "EQUAL", value: "BUS" });
    if (d.includes("SCHOOL")) {
      conditions.push({ field: "vehicleUse", operator: "EQUAL", value: "SCHOOL" });
      conditions.push({ field: "schoolOwnership", operator: "EQUAL", value: true });
    } else if (d.includes("BUS_OTHER")) {
      conditions.push({ field: "vehicleUse", operator: "NOT_EQUAL", value: "SCHOOL" });
    }
    if (d.includes("TAXI")) conditions.push({ field: "vehicleCategory", operator: "EQUAL", value: "TAXI" });
  }

  if (product === "TRACTOR" || product === "HARVESTER") {
    if (d.includes("NEW")) conditions.push({ field: "vehicleAge", operator: "LTE", value: 1 });
    if (d.includes("OLD")) conditions.push({ field: "vehicleAge", operator: "GT", value: 1 });
  }

  if (product === "CE") {
    if (d.includes("CONSTRUCTION")) conditions.push({ field: "vehicleUse", operator: "EQUAL", value: "CONSTRUCTION_EQUIPMENT" });
    if (d.includes("GARBAGE")) conditions.push({ field: "vehicleUse", operator: "EQUAL", value: "GARBAGE" });
    if (d.includes("OTHERS")) conditions.push({ field: "vehicleUse", operator: "EQUAL", value: "OTHER" });
  }

  if (product === "TWO_WHEELER") {
    conditions.push(...parseRange(d, "CC"));
    if (d === "SCOOTER") conditions.push({ field: "vehicleCategory", operator: "EQUAL", value: "SCOOTER" });
    if (b.includes("1+1")) conditions.push({ field: "policyType", operator: "EQUAL", value: "COMP_1_1" });
    if (b.includes("1+5")) conditions.push({ field: "policyType", operator: "EQUAL", value: "COMP_1_5" });
  }

  if (product === "PRIVATE_CAR") {
    if (b.includes("1+1")) conditions.push({ field: "policyType", operator: "EQUAL", value: "COMP_1_1" });
    else if (b.includes("1+3")) conditions.push({ field: "policyType", operator: "EQUAL", value: "COMP_1_3" });

    if (d.includes("DIESEL")) conditions.push({ field: "fuelType", operator: "EQUAL", value: "DIESEL" });
    if (d.includes("PETROL")) conditions.push({ field: "fuelType", operator: "EQUAL", value: "PETROL" });
    if (d.includes("ZERO NCB")) conditions.push({ field: "ncb", operator: "EQUAL", value: 0 });
    else if (d.includes("NCB")) conditions.push({ field: "ncb", operator: "GT", value: 0 });
  }

  return { product, conditions };
}

function payoutSheets(sheets: ExcelSheet[]): ExcelSheet[] {
  return sheets.filter(sheet => slabConditions(sheet.name) !== null);
}

export function parseMagmaRtoMappings(sheets: ExcelSheet[]): ImportedRtoMapping[] {
  const sheet = sheets.find(item => upper(item.name) === "RTO VS CLUSTER");
  if (!sheet) return [];

  // Magma uses at least two source layouts:
  // Comprehensive: UW RTO | Revised RTO Code | Product Category | Region | State | UW Cluster | Actuarial Cluster
  // SATP:          RTO Code | Product Category | Location | UW Cluster | Actuarial Cluster | Cluster State
  // Detect columns from source headers instead of assuming one fixed layout.
  let headerRow = -1;
  let columns: Record<string, number> = {};
  for (let i = 0; i < Math.min(sheet.rows.length, 6); i++) {
    const headers = (sheet.rows[i] || []).map(v => upper(v).replace(/[^A-Z0-9]+/g, " ").trim());
    const find = (...terms: string[]) => headers.findIndex(h => terms.every(t => h.includes(t)));
    const revised = find("REVISED", "RTO");
    const rto = revised >= 0 ? revised : headers.findIndex(h => h === "RTO CODE" || h === "UW RTO" || (h.includes("RTO") && h.includes("CODE")));
    const product = headers.findIndex(h => h.includes("PRODUCT") && h.includes("CATEGORY"));
    const cluster = headers.findIndex(h => h.includes("UW CLUSTER"));
    if (rto >= 0 && product >= 0 && cluster >= 0) {
      headerRow = i;
      columns = {
        rto,
        original: headers.findIndex(h => h === "UW RTO" || h === "RTO CODE"),
        product,
        region: headers.findIndex(h => h.includes("REGION") || h.includes("LOCATION DESC")),
        state: headers.findIndex(h => h === "RTO STATE" || h.includes("CLUSTER STATE")),
        cluster,
        actuarial: headers.findIndex(h => h.includes("ACTUARIAL CLUSTER"))
      };
      break;
    }
  }
  if (headerRow < 0) return [];

  const mappings: ImportedRtoMapping[] = [];
  const seen = new Set<string>();
  for (let rowIndex = headerRow + 1; rowIndex < sheet.rows.length; rowIndex++) {
    const row = sheet.rows[rowIndex] || [];
    const sourceRto = columns.original >= 0 ? row[columns.original] : row[columns.rto];
    const originalRtoCode = clean(sourceRto);
    const rtoCode = normalizeRto(row[columns.rto] || sourceRto);
    const product = normalizeMagmaProduct(row[columns.product]);
    const region = columns.region >= 0 ? clean(row[columns.region]) : "";
    const state = columns.state >= 0 ? clean(row[columns.state]) : "";
    const cluster = upper(row[columns.cluster]);
    const actuarialCluster = columns.actuarial >= 0 ? clean(row[columns.actuarial]) : "";
    if (!rtoCode || !product || !cluster || rtoCode.includes("NOTEXIST")) continue;
    // Reject obvious non-RTO labels from malformed/header rows. Source-specific
    // alphanumeric suffixes (DL-01C, AS-01A) and 3-digit codes are preserved.
    if (!/^[A-Z]{2}-[A-Z0-9]{1,8}$/.test(rtoCode)) continue;
    const key = `${rtoCode}|${product}|${cluster}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push({
      rtoCode,
      originalRtoCode,
      product,
      cluster,
      region,
      state,
      actuarialCluster,
      source: { fileName: undefined, sheet: sheet.name, row: rowIndex + 1 }
    });
  }
  return mappings;
}

function parseGlobalGuidelines(sheet: ExcelSheet | undefined, ctx: MagmaParseContext): {
  rules: ImportedRule[];
  warnings: string[];
} {
  if (!sheet) return { rules: [], warnings: ["Magma Generic Guidelines sheet was not found."] };
  const rules: ImportedRule[] = [];
  const warnings: string[] = [];
  let blockedMode = false;

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || [];
    const serial = clean(row[0]);
    const note = clean(row[1]);
    const noteUpper = upper(note);

    if (noteUpper.includes("BELOW RTOS ARE BLOCKED")) {
      blockedMode = true;
      continue;
    }

    if (blockedMode) {
      if (serial && /^\d+$/.test(serial)) {
        blockedMode = false;
      } else {
        const match = note.match(/^([A-Za-z]{2})\s*-?\s*(\d{1,2})/);
        if (match) {
          const rto = `${match[1].toUpperCase()}-${match[2].padStart(2, "0")}`;
          rules.push({
            ruleCode: `MAGMA-${slug(ctx.version)}-GLOBAL-BLOCK-${rto.replace(/-/g, "")}`,
            product: "ALL",
            priority: 10000,
            conditions: [{ field: "rtoCode", operator: "EQUAL", value: rto }],
            result: { type: "DECLINE", reason: "Blocked RTO in Magma Generic Guidelines" },
            source: { fileName: ctx.fileName, sheet: sheet.name, row: i + 1, originalText: note }
          });
        }
        continue;
      }
    }

    if (noteUpper.includes("ROUTE BUSES") && noteUpper.includes("TOURIST BUSES")) {
      for (const use of ["ROUTE_BUS", "TOURIST_BUS"]) {
        rules.push({
          ruleCode: `MAGMA-${slug(ctx.version)}-GLOBAL-${use}`,
          product: "PCV",
          priority: 10000,
          conditions: [{ field: "vehicleUse", operator: "EQUAL", value: use }],
          result: { type: "NO_BUSINESS", reason: note },
          source: { fileName: ctx.fileName, sheet: sheet.name, row: i + 1, originalText: note }
        });
      }
    }

    if (noteUpper.includes("2W") && noteUpper.includes("REDUCE BY 2%") && noteUpper.includes("CPA")) {
      rules.push({
        ruleCode: `MAGMA-${slug(ctx.version)}-ADJ-2W-CPA`,
        product: "TWO_WHEELER",
        priority: 500,
        ruleKind: "ADJUSTMENT",
        conditions: [{ field: "cpaTaken", operator: "EQUAL", value: true }],
        result: { type: "PAYOUT", percentage: -2, basis: "GWP", reason: note },
        source: { fileName: ctx.fileName, sheet: sheet.name, row: i + 1, originalText: note }
      });
      warnings.push("Magma guideline automated: Two Wheeler payout is reduced by 2 percentage points when CPA is taken. If CPA is not supplied, comparison requests it before quoting the final payout.");
    }
    if (noteUpper.includes("NON DIESEL") && noteUpper.includes("PETROL")) {
      warnings.push("Magma guideline: Private Car non-diesel follows petrol rate. The comparison service normalizes non-diesel/non-electric private-car fuel to PETROL for Magma.");
    }
    if (noteUpper.includes("MAKE AND MODEL") && noteUpper.includes("20 TO 40T")) {
      warnings.push("Magma guideline contains make/model exceptions for the GCV 20-40T bucket. These are retained as a warning in V1 and should be added as an override mapping before production activation.");
    }
  }
  return { rules, warnings };
}

export function parseMagmaWorkbook(
  sheets: ExcelSheet[],
  ctx: MagmaParseContext
): GridImportResult {
  const rules: ImportedRule[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const rtoMappings = parseMagmaRtoMappings(sheets);

  const global = parseGlobalGuidelines(
    sheets.find(s => upper(s.name) === "GENERIC GUIDELINES"),
    ctx
  );
  rules.push(...global.rules);
  warnings.push(...global.warnings);

  for (const sheet of payoutSheets(sheets)) {
    const slab = slabConditions(sheet.name)!;
    if (sheet.rows.length < 5) {
      warnings.push(`Skipped ${sheet.name}: too few rows.`);
      continue;
    }

    // Known Magma structure: row 1 = Biz Mix, row 2 = Budget Mix,
    // row 3 = UW Cluster/Outgo on, row 4+ = cluster payout matrix.
    const bizRow = sheet.rows[1] || [];
    const budgetRow = sheet.rows[2] || [];
    const basisRow = sheet.rows[3] || [];
    const maxColumns = Math.max(bizRow.length, budgetRow.length, basisRow.length);

    const columns: Array<{ index: number; product: string; conditions: ImportedCondition[]; label: string }> = [];
    for (let col = 1; col < maxColumns; col++) {
      const bizMix = clean(bizRow[col]);
      const budgetMix = clean(budgetRow[col]);
      const basis = upper(basisRow[col]);
      if (!bizMix && !budgetMix) continue;
      if (basis && basis !== "GWP") {
        warnings.push(`${sheet.name} column ${col + 1}: unexpected payout basis '${basis}', parsed as GWP only if payout is numeric.`);
      }
      const parsed = columnConditions(bizMix, budgetMix);
      if (!parsed.product) continue;
      columns.push({
        index: col,
        product: parsed.product,
        conditions: parsed.conditions,
        label: `${bizMix} | ${budgetMix}`
      });
    }

    for (let rowIndex = 4; rowIndex < sheet.rows.length; rowIndex++) {
      const row = sheet.rows[rowIndex] || [];
      const cluster = upper(row[0]);
      if (!cluster || ["KEY", "BIZ MIX", "BUDGET MIX", "UW CLUSTER/OUTGO ON"].includes(cluster)) continue;

      for (const col of columns) {
        const result = parsePayout(row[col.index]);
        if (!result) continue;
        const ruleCode = `MAGMA-${slug(ctx.version)}-${slug(sheet.name)}-${slug(cluster)}-C${col.index + 1}-R${rowIndex + 1}`;
        rules.push({
          ruleCode,
          product: col.product,
          priority: 100,
          conditions: [
            { field: "uwCluster", operator: "EQUAL", value: cluster },
            ...slab,
            ...col.conditions
          ],
          result,
          source: {
            fileName: ctx.fileName,
            sheet: sheet.name,
            row: rowIndex + 1,
            column: String(col.index + 1),
            originalText: `${cluster} | ${col.label} | ${clean(row[col.index])}`
          }
        });
      }
    }
  }

  if (rtoMappings.length === 0) errors.push("No Magma RTO mappings were detected.");
  if (rules.length === 0) errors.push("No Magma commission rules were detected.");

  return {
    insurerCode: "MAGMA_HD",
    fileName: ctx.fileName,
    rules,
    rtoMappings,
    warnings,
    errors
  };
}
