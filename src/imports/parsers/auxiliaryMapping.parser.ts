import { ExcelSheet } from "../excelReader";
import { ImportedRtoMapping } from "../types";
import { clean, normalizeRto, upper } from "./helpers";

function h(v: unknown) {
  return upper(v).replace(/[^A-Z0-9]+/g, " ").trim();
}

function inferProduct(sheetName: string, clusterHeader: string, scope: string[]): string {
  const text = `${h(sheetName)} ${h(clusterHeader)}`;
  if (/PVT|PRIVATE|CAR/.test(text)) return "PRIVATE_CAR";
  if (/\bTW\b|2W|TWO WHEELER/.test(text)) return "TWO_WHEELER";
  if (/PCV|PASSENGER|BUS|TAXI/.test(text)) return "PCV";
  if (/CV|GCV|COMMERCIAL/.test(text)) return "GCV";
  if (scope.length === 1) return scope[0];
  return "ALL";
}


function parseRoyalSundaramMaster(sheet: ExcelSheet, fileName: string): ImportedRtoMapping[] | null {
  const max = Math.min(sheet.rows.length, 10);
  for (let rowIndex = 0; rowIndex < max; rowIndex++) {
    const row = sheet.rows[rowIndex] || [];
    const headers = row.map(h);
    const rtoCol = headers.findIndex(x => x === "RTO NO" || x === "RTO" || (x.includes("RTO") && x.includes("NO")));
    const pcCol = headers.findIndex(x => x.includes("TP ULR LOCATION 2026 27") && !x.endsWith(" CV"));
    const cvCol = headers.findIndex(x => x.includes("TP ULR LOCATION 2026 27 CV"));
    if (rtoCol < 0 || (pcCol < 0 && cvCol < 0)) continue;
    const rtoNameCol = headers.findIndex(x => x.includes("RTO NAME"));
    const statePcCol = pcCol >= 0 ? headers.findIndex((x, i) => i > pcCol && x === "STATE" && i < (cvCol >= 0 ? cvCol : headers.length)) : -1;
    const stateCvCol = cvCol >= 0 ? headers.findIndex((x, i) => i > cvCol && x === "STATE") : -1;
    const out: ImportedRtoMapping[] = [];
    for (let i = rowIndex + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] || [];
      const original = clean(r[rtoCol]);
      const code = normalizeRto(original);
      if (!/^[A-Z]{2}-\d{2}$/.test(code)) continue;
      const location = rtoNameCol >= 0 ? clean(r[rtoNameCol]) : "";
      const pc = pcCol >= 0 ? clean(r[pcCol]) : "";
      const cv = cvCol >= 0 ? clean(r[cvCol]) : "";
      const statePc = statePcCol >= 0 ? clean(r[statePcCol]) : "";
      const stateCv = stateCvCol >= 0 ? clean(r[stateCvCol]) : "";
      if (pc) {
        for (const product of ["PRIVATE_CAR", "TWO_WHEELER"]) out.push({
          rtoCode: code, originalRtoCode: original, product, cluster: upper(pc), state: statePc || undefined,
          location: location || undefined, mappingClass: product === "PRIVATE_CAR" ? "PRIVATE_CAR" : "TWO_WHEELER",
          source: { fileName, sheet: sheet.name, row: i + 1 }
        });
      }
      if (cv) {
        for (const product of ["GCV", "PCV"]) out.push({
          rtoCode: code, originalRtoCode: original, product, cluster: upper(cv), state: stateCv || undefined,
          location: location || undefined, mappingClass: product, source: { fileName, sheet: sheet.name, row: i + 1 }
        });
      }
    }
    return out;
  }
  return null;
}

function findHeader(sheet: ExcelSheet) {
  const max = Math.min(sheet.rows.length, 15);
  for (let rowIndex = 0; rowIndex < max; rowIndex++) {
    const row = sheet.rows[rowIndex] || [];
    const headers = row.map(h);
    const rtoCol = headers.findIndex(x => x === "RTO" || (x.includes("RTO") && (x.includes("CODE") || x.includes("NO"))));
    let clusterCandidates = headers
      .map((x, i) => ({ x, i }))
      .filter(v => v.x.includes("CLUSTER"));
    // Some insurers call the payout geography a ULR/location rather than a cluster.
    // Only accept clearly derived geography columns; never use plain RTO_NAME/RTO_LOCATION as a payout cluster.
    if (!clusterCandidates.length) {
      clusterCandidates = headers
        .map((x, i) => ({ x, i }))
        .filter(v => (v.x.includes("ULR") && v.x.includes("LOCATION")) || (v.x.includes("LOCATION") && /\bCV\b|REGION|ZONE/.test(v.x)));
    }
    if (rtoCol >= 0 && clusterCandidates.length) {
      const clusterCol = clusterCandidates[clusterCandidates.length - 1].i;
      const stateCol = headers.findIndex(x => x.includes("STATE"));
      const locationCol = headers.findIndex(x => x.includes("LOCATION") || x.includes("CITY"));
      const regionCol = headers.findIndex(x => x.includes("REGION"));
      return { rowIndex, headers, rtoCol, clusterCol, stateCol, locationCol, regionCol };
    }
  }
  return null;
}

export function parseAuxiliaryRtoMappings(
  sheets: ExcelSheet[],
  ctx: { fileName: string; productScope?: string[] }
): { mappings: ImportedRtoMapping[]; warnings: string[]; errors: string[] } {
  const mappings: ImportedRtoMapping[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const sheet of sheets) {
    const royal = parseRoyalSundaramMaster(sheet, ctx.fileName);
    if (royal) {
      for (const m of royal) {
        const key = `${m.rtoCode}|${m.product}|${m.mappingClass || ""}|${upper(m.cluster)}`;
        if (!seen.has(key)) { seen.add(key); mappings.push(m); }
      }
      continue;
    }
    const header = findHeader(sheet);
    if (!header) continue;
    const clusterHeader = clean((sheet.rows[header.rowIndex] || [])[header.clusterCol]);
    const product = inferProduct(sheet.name, clusterHeader, ctx.productScope || []);

    for (let i = header.rowIndex + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] || [];
      const original = clean(row[header.rtoCol]);
      const rtoCode = normalizeRto(original);
      const cluster = clean(row[header.clusterCol]);
      if (!rtoCode || !cluster || rtoCode === "RTO" || rtoCode.includes("TOTAL")) continue;
      // Reject PIN codes/serials and other non-RTO rows accidentally present in insurer masters.
      // Valid source RTO identifiers begin with a two-letter state/UT prefix and may
      // contain numeric/alphanumeric suffixes (e.g. MH-01, DL-01C, AS-01A, AP-121).
      if (!/^[A-Z]{2}-[A-Z0-9]{1,8}$/.test(rtoCode)) continue;
      const state = header.stateCol >= 0 ? clean(row[header.stateCol]) : "";
      const location = header.locationCol >= 0 ? clean(row[header.locationCol]) : "";
      const region = header.regionCol >= 0 ? clean(row[header.regionCol]) : "";
      const key = `${rtoCode}|${product}|${upper(cluster)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mappings.push({
        rtoCode,
        originalRtoCode: original,
        product,
        cluster: upper(cluster),
        state: state || undefined,
        location: location || undefined,
        region: region || undefined,
        source: { fileName: ctx.fileName, sheet: sheet.name, row: i + 1 }
      });
    }
  }

  if (!mappings.length) {
    warnings.push(`No deterministic RTO→cluster table was detected in ${ctx.fileName}.`);
  }
  return { mappings, warnings, errors: [] };
}
