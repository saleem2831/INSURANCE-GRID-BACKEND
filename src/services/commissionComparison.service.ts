import InsuranceCompany from "../models/InsuranceCompany";
import CommissionGrid from "../models/CommissionGrid";
import CommissionRule from "../models/CommissionRule";
import GridPackage from "../models/GridPackage";
import RtoMapping from "../models/RtoMapping";
import { getFieldValue, matchConditions } from "../engine/matcher";
import { validateRequiredComparisonFields, COMPARISON_FIELD_CATALOG } from "./comparisonInputValidation";
import { deriveStateFromRto, normalizeRtoCode, normalizeStateName } from "./canonicalRto.service";
import { canonicalCompanyCode, INSURER_CODES } from "../config/insurers";
import { syncInsurerCatalog } from "./insurerCatalog.service";
import { mapWithConcurrency } from "../utils/asyncPool";

export interface CommissionCompareInput {
  product: string;
  filters?: {
    insurerCodes?: string[];
    statuses?: string[];
    matchedOnly?: boolean;
    minPercentage?: number;
    minCommissionAmount?: number;
  };
  [key: string]: any;
}

const FIELD_LABELS: Record<string, string> = {
  "businessMetrics.monthlyGwp": "Monthly GWP / Volume",
  "businessMetrics.nop": "NOP",
  odDiscountPercent: "OD Discount %",
  geoCluster: "Insurer Geo Segment",
  rtoCluster: "RTO Cluster",
  rtoSubCluster: "RTO Sub Cluster",
  rtoRegion: "RTO Region / Location",
  businessType: "Business Type",
  vehicleType: "Vehicle Type",
  vehicleCategory: "Vehicle Category",
  vehicleSegment: "Vehicle Segment",
  carrierType: "Carrier Type",
  addOnCover: "Add-on Cover",
  nilDep: "Nil Dep / Zero Dep",
  evKw: "EV kW",
  schoolOwnership: "School Ownership",
  cpaTaken: "CPA Taken",
  seatingCapacity: "Seating Capacity",
  model: "Vehicle Model",
  make: "Vehicle Make",
  ncb: "NCB %",
  fuelType: "Fuel Type",
  cc: "CC",
  gvw: "GVW",
  rtoState: "RTO State",
  ownershipType: "Ownership Type",
  policyType: "Product / Cover Type",
  vehicleAge: "Vehicle Age",
  rtoCode: "RTO",
  tataIncrementalClass: "Tata Segment",
  "insurerContext.cholaMarket": "Chola Market",
  "insurerContext.iffcoCompSegment": "IFFCO Comprehensive Segment",
  "insurerContext.iffcoCompZone": "IFFCO Comprehensive Zone",
  "insurerContext.iffcoSatpSegment": "IFFCO SATP Segment",
  "insurerContext.iffcoSatpZone": "IFFCO SATP Zone",
  "insurerContext.hdfcPvtCarZone": "HDFC Private Car Zone"
};

function normalizeProduct(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (["PRIVATE_CAR", "PVT_CAR", "PVT CAR", "PRIVATE CAR", "PC"].includes(s)) return "PRIVATE_CAR";
  if (["TWO_WHEELER", "2W", "TW", "TWO WHEELER"].includes(s)) return "TWO_WHEELER";
  if (s.includes("GCV")) return "GCV";
  if (s.includes("PCV")) return "PCV";
  return s.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function scalar(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  return s;
}

function normToken(v: unknown) {
  return String(v ?? "")
    .toUpperCase()
    .replace(/ANDRA/g, "ANDHRA")
    .replace(/UTTARANCHAL/g, "UTTARAKHAND")
    .replace(/CHATTISGARH/g, "CHHATTISGARH")
    .replace(/TELENGANA/g, "TELANGANA")
    .replace(/BHUBANESHWAR/g, "BHUBANESWAR")
    .replace(/[^A-Z0-9]/g, "");
}

function empty(v: unknown) { return v === undefined || v === null || v === ""; }

function setFieldValue(target: Record<string, any>, field: string, value: unknown) {
  const parts = field.split(".").filter(Boolean);
  let cursor: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function normalizeInput(product: string, input: CommissionCompareInput) {
  const p: any = { ...input, product, insurerContext: { ...(input.insurerContext || {}) } };
  delete p.filters;
  for (const k of Object.keys(p)) {
    if (["premium", "businessMetrics", "insurerContext"].includes(k)) continue;
    p[k] = scalar(p[k]);
  }
  if (input.rtoCode) p.rtoCode = normalizeRtoCode(input.rtoCode);
  for (const k of [
    "fuelType", "policyType", "vehicleCategory", "vehicleUse", "vehicleType", "ownershipType", "businessType",
    "carrierType", "vehicleSegment", "make", "model", "makeGroup", "geoCluster", "rtoCluster", "rtoSubCluster",
    "rtoRegion", "rtoState", "zone"
  ]) if (!empty(p[k])) p[k] = String(p[k]).trim().toUpperCase();
  p.businessMetrics = Object.fromEntries(Object.entries(input.businessMetrics ?? {}).map(([k, v]) => [k, scalar(v)]));
  p.premium = Object.fromEntries(Object.entries(input.premium ?? {}).map(([k, v]) => [k, scalar(v)]));
  if (p.rtoCode && !p.rtoState) {
    const state = deriveStateFromRto(p.rtoCode);
    if (state) {
      p.rtoState = state.stateName;
      p.rtoStateCode = state.stateCode;
    }
  } else if (p.rtoState) {
    p.rtoState = normalizeStateName(p.rtoState);
  }
  if (product === "PCV" && p.vehicleUse === "SCHOOL" && empty(p.schoolOwnership) && String(p.ownershipType || "").includes("SCHOOL")) p.schoolOwnership = true;
  if (p.vehicleType === "BIKE") p.vehicleType = "MOTOR_CYCLE";
  return p;
}

function basisAmount(input: any, basis?: string | null) {
  const pr = input.premium ?? {};
  const od = Number(pr.odPremium ?? input.odPremium);
  const tp = Number(pr.tpPremium ?? input.tpPremium);
  const map: Record<string, unknown> = {
    GWP: pr.gwp ?? input.gwp,
    GROSS: pr.grossPremium ?? input.grossPremium,
    OD: pr.odPremium ?? input.odPremium,
    TP: pr.tpPremium ?? input.tpPremium,
    NET: pr.netPremium ?? input.netPremium,
    OD_TP: pr.odTpPremium ?? input.odTpPremium ?? (Number.isFinite(od) && Number.isFinite(tp) ? od + tp : undefined)
  };
  if (!basis || basis === "FIXED") return null;
  const n = Number(map[basis]);
  return Number.isFinite(n) ? n : null;
}

function normalizedResultSignature(r: any) {
  return {
    type: r?.type ?? null,
    percentage: r?.percentage ?? null,
    basis: r?.basis ?? null,
    fixedAmount: r?.fixedAmount ?? null,
    setField: r?.setField ?? null,
    value: r?.value ?? null,
    components: Array.isArray(r?.components) ? r.components.map((x: any) => ({ basis: x.basis, percentage: x.percentage })) : []
  };
}
function sameResult(a: any, b: any) { return JSON.stringify(normalizedResultSignature(a)) === JSON.stringify(normalizedResultSignature(b)); }

function chooseWinner(evals: any[]) {
  const matched = evals.filter(x => x.match.matched);
  if (!matched.length) return { winner: null, ambiguous: false, candidates: [] as any[] };
  const pr = Math.max(...matched.map(x => Number(x.rule.priority ?? 0)));
  let candidates = matched.filter(x => Number(x.rule.priority ?? 0) === pr);
  const sp = Math.max(...candidates.map(x => (x.rule.conditions ?? []).length));
  candidates = candidates.filter(x => (x.rule.conditions ?? []).length === sp);
  const ambiguous = candidates.some(x => !sameResult(x.rule.result, candidates[0].rule.result));
  return { winner: ambiguous ? null : candidates[0], ambiguous, candidates };
}

function conditionOptions(condition: any): unknown[] {
  if (condition.operator === "EQUAL") return [condition.value];
  if (condition.operator === "IN" && Array.isArray(condition.value)) return condition.value;
  return [];
}

function missingInputCandidates(rules: any[], policy: any) {
  const candidates: any[] = [];
  for (const rule of rules) {
    const missing: any[] = [];
    let hard = false;
    for (const c of rule.conditions ?? []) {
      const actual = getFieldValue(policy, c.field);
      if (empty(actual)) { missing.push(c); continue; }
      if (!matchConditions(policy, [c] as any).matched) { hard = true; break; }
    }
    if (!hard && missing.length) candidates.push({ rule, missing });
  }
  if (!candidates.length) return [];
  const min = Math.min(...candidates.map(x => x.missing.length));
  const near = candidates.filter(x => x.missing.length === min);
  const by = new Map<string, Set<any>>();
  for (const x of near) for (const c of x.missing) {
    if (!by.has(c.field)) by.set(c.field, new Set());
    for (const o of conditionOptions(c)) by.get(c.field)!.add(o);
  }
  return [...by.entries()].map(([field, set]) => {
    const def = (COMPARISON_FIELD_CATALOG as any)[field];
    return {
      field,
      label: def?.label || FIELD_LABELS[field] || field,
      type: def?.type || "text",
      options: [...set].length ? [...set].slice(0, 60) : (def?.options || []),
      requiredByRules: near.slice(0, 8).map(x => x.rule.ruleCode)
    };
  });
}

function possibleValues(rules: any[], field: string) {
  const vals: any[] = [];
  for (const r of rules) for (const c of r.conditions ?? []) if (c.field === field) for (const v of conditionOptions(c)) vals.push(v);
  return [...new Set(vals.map(v => String(v)))];
}
function autoResolveField(policy: any, rules: any[], field: string, contexts: string[]) {
  if (!empty(policy[field])) return;
  const vals = possibleValues(rules, field);
  if (!vals.length) return;
  const ctx = contexts.map(normToken).filter(Boolean);
  const matches = vals.filter(v => {
    const nv = normToken(v);
    return nv && ctx.some(c => nv === c || nv.includes(c) || c.includes(nv));
  });
  if (matches.length === 1) policy[field] = String(matches[0]).toUpperCase();
}

function mappingClass(policy: any, product: string) {
  const policyType = String(policy.policyType || "").toUpperCase();
  const fuel = String(policy.fuelType || "").toUpperCase();
  const vehicleType = String(policy.vehicleType || policy.vehicleCategory || "").toUpperCase();
  const vehicleUse = String(policy.vehicleUse || "").toUpperCase();

  if (product === "PRIVATE_CAR") return "PRIVATE_CAR";

  if (product === "TWO_WHEELER") {
    if (["COMP_1_1", "COMP1_1", "COMP_1+1", "SATP", "TP"].includes(policyType)) return "TW_1_1_SATP";
    if (["COMP_1_5", "COMP1_5", "COMP_1+5"].includes(policyType)) return "TW_1_5";
    if (["SAOD", "OD", "STANDALONE_OD"].includes(policyType)) return "TW_SAOD";
    return "TWO_WHEELER";
  }

  if (product === "PCV") {
    if (vehicleUse === "TAXI" || vehicleType.includes("TAXI")) return "TAXI";
    const is3w = vehicleType.includes("3W") || vehicleType.includes("THREE_WHEELER") || vehicleType.includes("THREE WHEELER");
    if (is3w) return fuel === "ELECTRIC" || fuel === "EV" ? "PCV3_EV" : "PCV3_NON_EV";
    const seats = Number(policy.seatingCapacity);
    return Number.isFinite(seats) && seats > 5 ? "PCV6PLUS" : "PCV5";
  }

  if (product === "GCV") {
    if (["TRACTOR", "MISC_D", "MISC", "HARVESTER"].some(x => vehicleType.includes(x))) return "TRACTOR_MISC";
    if (vehicleType.includes("3W") || vehicleType.includes("THREE_WHEELER") || vehicleType.includes("THREE WHEELER")) return "GCV3";
    const gvw = Number(policy.gvw);
    if (!Number.isFinite(gvw)) return null;
    if (gvw <= 7500) return "LCV";
    if (gvw <= 12000) return "MCV";
    return "HCV";
  }
  return null;
}

async function enrichRto(policy: any, product: string, companyId: any, gridIds: any[]) {
  if (!policy.rtoCode) return;
  const own = await RtoMapping.find({ insuranceCompanyId: companyId, gridId: { $in: gridIds }, rtoCode: policy.rtoCode, product: { $in: [product, "ALL"] } }).lean();
  if (!own.length) return;
  const klass = mappingClass(policy, product);
  let candidates = klass ? own.filter((m: any) => !m.mappingClass || m.mappingClass === klass) : own;
  if (!candidates.length) candidates = own;
  const unique = [...new Map(candidates.map((m: any) => [`${m.cluster}|${m.region}|${m.mappingClass}`, m])).values()] as any[];
  if (unique.length === 1) {
    const m = unique[0];
    const cluster = String(m.cluster).toUpperCase();
    policy.uwCluster = cluster;
    if (empty(policy.rtoCluster)) policy.rtoCluster = cluster;
    if (empty(policy.geoCluster)) policy.geoCluster = cluster;
    if (m.region) policy.rtoRegion = String(m.region).toUpperCase();
    if (m.state) policy.rtoState = normalizeStateName(m.state);
    if (m.location) policy.rtoLocation = String(m.location).toUpperCase();
    if (m.subCluster) policy.rtoSubCluster = String(m.subCluster).toUpperCase();
    if (m.actuarialCluster) policy.actuarialCluster = m.actuarialCluster;
  }
}

function deriveTataClass(policy: any, product: string) {
  if (product === "TWO_WHEELER") return "TW";
  if (product === "PCV") return String(policy.vehicleType || "").includes("BUS") || ["SCHOOL", "STAFF"].includes(String(policy.vehicleUse || "")) ? "BUS" : "PCV";
  if (product === "GCV") {
    const g = Number(policy.gvw);
    return Number.isFinite(g) && g <= 7500 ? "LCV" : "MNHCV";
  }
  return "";
}

function gridInfo(gridMap: Map<string, any>, rule: any) {
  const g = gridMap.get(String(rule?.gridId));
  return { gridId: g?._id ?? rule?.gridId, gridVersion: g?.version ?? null, logicalKey: g?.logicalKey ?? null, packageId: g?.packageId ?? null };
}
function sourceAudit(rule: any, grid: any) {
  const s = rule?.source ?? {};
  return { sourceText: s.originalText ?? null, sheet: s.sheet ?? null, row: s.row ?? null, column: s.column ?? null, fileName: s.fileName ?? grid?.source?.fileName ?? null };
}

function applyFilters(results: any[], f: any) {
  if (!f) return results;
  const ins = new Set((f.insurerCodes ?? []).map((x: any) => canonicalCompanyCode(x)));
  const sts = new Set((f.statuses ?? []).map((x: any) => String(x).toUpperCase()));
  return results.filter(r =>
    (!ins.size || ins.has(canonicalCompanyCode(r.companyCode))) &&
    (!sts.size || sts.has(String(r.status).toUpperCase())) &&
    (!f.matchedOnly || r.status === "MATCHED") &&
    (typeof f.minPercentage !== "number" || (typeof r.percentage === "number" && r.percentage >= f.minPercentage)) &&
    (typeof f.minCommissionAmount !== "number" || (typeof r.commissionAmount === "number" && r.commissionAmount >= f.minCommissionAmount))
  );
}

function applyDerivations(policy: any, rules: any[]) {
  const derivations = rules.filter((r: any) => r.ruleKind === "DERIVATION" || r.result?.type === "DERIVE");
  const applied: any[] = [];
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const byField = new Map<string, any[]>();
    for (const rule of derivations) {
      const field = rule.result?.setField;
      if (!field || empty(rule.result?.value)) continue;
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push(rule);
    }
    for (const [field, fieldRules] of byField.entries()) {
      const sel = chooseWinner(fieldRules.map(rule => ({ rule, match: matchConditions(policy, rule.conditions as any) })));
      if (sel.ambiguous) return { ok: false, reason: `Conflicting derivation rules matched for ${field}.`, candidateRules: sel.candidates.map((x: any) => x.rule.ruleCode), applied };
      if (!sel.winner) continue;
      const value = sel.winner.rule.result.value;
      const current = getFieldValue(policy, field);
      if (JSON.stringify(current) !== JSON.stringify(value)) {
        setFieldValue(policy, field, value);
        changed = true;
      }
      if (!applied.some(x => x.ruleCode === sel.winner.rule.ruleCode)) applied.push({ ruleCode: sel.winner.rule.ruleCode, field, value, source: sel.winner.rule.source });
    }
    if (!changed) break;
  }
  return { ok: true, applied };
}

function missingDerivationInputs(rules: any[], policy: any) {
  const derivations = rules.filter((r: any) => r.ruleKind === "DERIVATION" || r.result?.type === "DERIVE");
  const byTarget = new Map<string, any[]>();
  for (const r of derivations) {
    const field = r.result?.setField;
    if (!field || !empty(getFieldValue(policy, field))) continue;
    if (!byTarget.has(field)) byTarget.set(field, []);
    byTarget.get(field)!.push(r);
  }
  const out = new Map<string, any>();
  for (const fieldRules of byTarget.values()) {
    for (const item of missingInputCandidates(fieldRules, policy)) {
      if (!out.has(item.field)) out.set(item.field, item);
      else {
        const cur = out.get(item.field);
        cur.requiredByRules = [...new Set([...(cur.requiredByRules || []), ...(item.requiredByRules || [])])].slice(0, 12);
        cur.options = [...new Set([...(cur.options || []), ...(item.options || [])])].slice(0, 60);
      }
    }
  }
  return [...out.values()];
}

function maxAllowedPayoutPercentage() {
  const configured = Number(process.env.MAX_SOURCE_PAYOUT_PERCENT || 500);
  return Number.isFinite(configured) && configured > 0 ? configured : 500;
}

function evaluatePayout(result: any, policy: any) {
  if (Array.isArray(result?.components) && result.components.length) {
    const components = result.components.map((c: any) => {
      const percentage = Number(c.percentage);
      const baseAmount = basisAmount(policy, c.basis);
      return {
        basis: c.basis,
        percentage,
        basisAmount: baseAmount,
        commissionAmount: baseAmount !== null && Number.isFinite(percentage) ? Number((baseAmount * percentage / 100).toFixed(2)) : null
      };
    });
    const maxPct = maxAllowedPayoutPercentage();
    const invalid = components.some((c: any) => !Number.isFinite(c.percentage) || c.percentage < 0 || c.percentage > maxPct);
    if (invalid) return { valid: false, reason: `One or more component percentages are outside the configured source range 0-${maxPct}.` };
    const uniquePcts = [...new Set(components.map((c: any) => c.percentage))];
    const allAmounts = components.every((c: any) => typeof c.commissionAmount === "number");
    const commissionAmount = allAmounts ? Number(components.reduce((sum: number, c: any) => sum + c.commissionAmount, 0).toFixed(2)) : null;
    return {
      valid: true,
      composite: true,
      percentage: uniquePcts.length === 1 ? uniquePcts[0] : null,
      basis: null,
      basisAmount: null,
      commissionAmount,
      payoutComponents: components,
      percentageDisplay: components.map((c: any) => `${c.basis} ${c.percentage}%`).join(" + ")
    };
  }
  const percentage = Number(result?.percentage);
  const maxPct = maxAllowedPayoutPercentage();
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > maxPct) return { valid: false, reason: `Parsed percentage ${result?.percentage} is outside the configured source range 0-${maxPct}.` };
  const amountBase = basisAmount(policy, result?.basis);
  const commissionAmount = amountBase !== null ? Number((amountBase * percentage / 100).toFixed(2)) : (Number.isFinite(Number(result?.fixedAmount)) ? Number(result.fixedAmount) : null);
  return { valid: true, composite: false, percentage, basis: result?.basis ?? null, basisAmount: amountBase, commissionAmount, payoutComponents: [], percentageDisplay: `${percentage}%` };
}

export async function compareCommissions(input: CommissionCompareInput) {
  const product = normalizeProduct(input.product);
  if (!product) throw new Error("product is required");
  const validation = validateRequiredComparisonFields(product, input);
  if (!validation.valid) {
    const e: any = new Error(`Missing required payout-dependent fields for ${product}: ${validation.missing.map(x => x.field).join(", ")}`);
    e.statusCode = 400;
    e.details = validation;
    throw e;
  }
  const date = input.policyDate ? new Date(input.policyDate) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid policyDate");

  // The canonical JSON catalog is authoritative. Always evaluate every active
  // catalog company so the API returns a stable response row for every insurer.
  await syncInsurerCatalog();
  const companies = await InsuranceCompany.find({
    active: true,
    code: { $in: INSURER_CODES }
  }).lean();
  const catalogOrder = new Map(INSURER_CODES.map((code, index) => [code, index]));
  companies.sort((a: any, b: any) =>
    (catalogOrder.get(canonicalCompanyCode(a.code)) ?? 999) -
    (catalogOrder.get(canonicalCompanyCode(b.code)) ?? 999)
  );

  const concurrency = Math.max(1, Math.min(12, Number(process.env.COMPARE_CONCURRENCY || 6)));
  const results = await mapWithConcurrency(companies, concurrency, async (catalogCompany: any) => {
    const startedAt = Date.now();
    const companyResults: any[] = [];
    try {
      // Keep the existing deterministic evaluation flow intact while each insurer
      // runs independently and asynchronously. `continue` exits this one-item loop.
      for (const company of [catalogCompany]) {
    const activePackage: any = await GridPackage.findOne({
      insuranceCompanyId: company._id,
      status: "ACTIVE",
      effectiveFrom: { $lte: date },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }]
    }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();

    let grids: any[] = [];
    if (activePackage?.gridId) grids = await CommissionGrid.find({ _id: activePackage.gridId, insuranceCompanyId: company._id, status: "ACTIVE" }).lean();
    else grids = await CommissionGrid.find({
      insuranceCompanyId: company._id,
      status: "ACTIVE",
      packageId: null,
      effectiveFrom: { $lte: date },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }]
    }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();

    if (!grids.length) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "NO_GRID", displayStatus: "NO ACTIVE GRID", percentage: null, message: "No ACTIVE company package/grid applicable for the policy date" });
      continue;
    }

    const gridIds = grids.map((g: any) => g._id);
    const gridMap: Map<string, any> = new Map(grids.map((g: any) => [String(g._id), g] as [string, any]));
    const policy = normalizeInput(product, input);
    const companyCode = canonicalCompanyCode(company.code);
    if (companyCode === "MAGMA" && product === "PRIVATE_CAR" && policy.fuelType && !["DIESEL", "ELECTRIC"].includes(String(policy.fuelType))) policy.fuelType = "PETROL";
    if (empty(policy.vehicleType) && !empty(policy.vehicleCategory)) policy.vehicleType = String(policy.vehicleCategory).toUpperCase();
    await enrichRto(policy, product, company._id, gridIds);

    const rules = await CommissionRule.find({ insuranceCompanyId: company._id, gridId: { $in: gridIds }, product: { $in: [product, "ALL"] }, active: true }).sort({ priority: -1, ruleCode: 1 }).lean();
    if (!rules.length) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "NO_RULES", displayStatus: "NOT APPLICABLE", percentage: null, activeGridFiles: grids.map((g: any) => g.source?.fileName), message: "Active grid files exist, but none contains executable rules for this product." });
      continue;
    }

    const contexts = [policy.rtoState, policy.rtoRegion, policy.rtoLocation].filter(Boolean);
    for (const f of ["rtoState", "rtoRegion", "rtoCluster", "geoCluster", "rtoSubCluster"]) autoResolveField(policy, rules, f, contexts);
    if (companyCode === "TATA_AIG") policy.tataIncrementalClass = deriveTataClass(policy, product);

    const derivation = applyDerivations(policy, rules);
    if (!derivation.ok) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: derivation.reason, candidateRules: derivation.candidateRules, derivedContext: policy.insurerContext });
      continue;
    }

    const derivationMissing = missingDerivationInputs(rules, policy);
    if (derivationMissing.length) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "NEEDS_INPUT", percentage: null, missingFields: derivationMissing, message: "Additional input is required to resolve an insurer source mapping before payout can be calculated safely.", derivations: derivation.applied });
      continue;
    }

    const exclusions = rules.filter((r: any) => r.ruleKind === "EXCLUSION");
    const exSel = chooseWinner(exclusions.map((r: any) => ({ rule: r, match: matchConditions(policy, r.conditions as any) })));
    if (exSel.ambiguous) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: "Conflicting exclusion rules matched.", candidateRules: exSel.candidates.map((x: any) => x.rule.ruleCode) });
      continue;
    }
    if (exSel.winner) {
      const rr = exSel.winner.rule;
      const g = gridMap.get(String(rr.gridId));
      companyResults.push({ companyCode: company.code, companyName: company.name, status: rr.result.type, percentage: null, ...gridInfo(gridMap, rr), ruleCode: rr.ruleCode, source: rr.source, percentageAudit: sourceAudit(rr, g), reason: rr.result.reason ?? null, derivations: derivation.applied, resolvedInputs: policy });
      continue;
    }
    // Accuracy safeguard: if a source exclusion/decline is a near-match but needs
    // one more field (model, make, Nil Dep, etc.), never quote a base payout first.
    const exclusionMissing = missingInputCandidates(exclusions, policy);
    if (exclusionMissing.length) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "NEEDS_INPUT", percentage: null, missingFields: exclusionMissing, message: "A source decline/exclusion may apply. Complete the required field(s) before a payout can be quoted safely." });
      continue;
    }

    const bases = rules.filter((r: any) => !["DERIVATION", "ADJUSTMENT", "OVERRIDE", "EXCLUSION"].includes(r.ruleKind));
    const baseSel = chooseWinner(bases.map((r: any) => ({ rule: r, match: matchConditions(policy, r.conditions as any) })));
    if (baseSel.ambiguous) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: "Multiple equally-specific source rules match with different payouts; percentage withheld.", candidateRules: baseSel.candidates.map((x: any) => ({ ruleCode: x.rule.ruleCode, result: x.rule.result, source: x.rule.source })) });
      continue;
    }
    if (!baseSel.winner) {
      const missing = missingInputCandidates(bases, policy);
      companyResults.push({ companyCode: company.code, companyName: company.name, status: missing.length ? "NEEDS_INPUT" : "NO_MATCH", percentage: null, missingFields: missing, rtoContext: { rtoCode: policy.rtoCode, rtoState: policy.rtoState, rtoRegion: policy.rtoRegion, rtoCluster: policy.rtoCluster, geoCluster: policy.geoCluster, uwCluster: policy.uwCluster }, derivedContext: policy.insurerContext, message: missing.length ? "Additional payout-dependent input is required for this insurer." : "No source rule matched the supplied vehicle/policy parameters." });
      continue;
    }

    let baseRule = baseSel.winner.rule;
    let baseResult = baseRule.result;
    let baseGrid = gridMap.get(String(baseRule.gridId));
    if (baseResult.type !== "PAYOUT") {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: baseResult.type, percentage: null, ...gridInfo(gridMap, baseRule), ruleCode: baseRule.ruleCode, source: baseRule.source, percentageAudit: sourceAudit(baseRule, baseGrid), reason: baseResult.reason ?? null, derivations: derivation.applied });
      continue;
    }

    const overrides = rules.filter((r: any) => r.ruleKind === "OVERRIDE");
    if (overrides.length) {
      const ovSel = chooseWinner(overrides.map((r: any) => ({ rule: r, match: matchConditions(policy, r.conditions as any) })));
      if (ovSel.ambiguous) {
        companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: "Conflicting override rules matched." });
        continue;
      }
      if (ovSel.winner) {
        baseRule = ovSel.winner.rule;
        baseResult = baseRule.result;
        baseGrid = gridMap.get(String(baseRule.gridId));
      } else {
        const missing = missingInputCandidates(overrides, policy);
        if (missing.length) {
          companyResults.push({ companyCode: company.code, companyName: company.name, status: "NEEDS_INPUT", percentage: null, baseRuleCode: baseRule.ruleCode, missingFields: missing, message: "A possible insurer override requires additional input before the final payout can be quoted accurately." });
          continue;
        }
      }
    }

    let payout = evaluatePayout(baseResult, policy);
    if (!payout.valid) {
      companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: payout.reason, ruleCode: baseRule.ruleCode });
      continue;
    }

    const adjustments = rules.filter((r: any) => r.ruleKind === "ADJUSTMENT");
    let adjustmentPct = 0;
    const adjustmentRules: any[] = [];
    if (adjustments.length) {
      const groups = new Map<string, any[]>();
      for (const r of adjustments) {
        const key = String(r.ruleGroup || "__DEFAULT__");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      let adjustmentBlocked = false;
      for (const [group, groupRules] of groups) {
        const adjSel = chooseWinner(groupRules.map((r: any) => ({ rule: r, match: matchConditions(policy, r.conditions as any) })));
        if (adjSel.ambiguous) {
          companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: `Conflicting adjustment rules matched in group ${group}.`, candidateRules: adjSel.candidates.map((x:any)=>x.rule.ruleCode) });
          adjustmentBlocked = true;
          break;
        }
        if (adjSel.winner) {
          const adjustmentRule = adjSel.winner.rule;
          if (payout.composite) {
            companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: "A source adjustment matched a composite OD/TP payout. Final payout is withheld until that adjustment basis is explicitly modeled.", baseRuleCode: baseRule.ruleCode, adjustmentRuleCode: adjustmentRule.ruleCode });
            adjustmentBlocked = true;
            break;
          }
          const pctDelta = Number(adjustmentRule.result?.percentage ?? 0);
          if (!Number.isFinite(pctDelta)) {
            companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: `Adjustment ${adjustmentRule.ruleCode} has a non-numeric percentage.` });
            adjustmentBlocked = true;
            break;
          }
          adjustmentPct += pctDelta;
          adjustmentRules.push(adjustmentRule);
        } else {
          const miss = missingInputCandidates(groupRules, policy);
          if (miss.length) {
            companyResults.push({ companyCode: company.code, companyName: company.name, status: "NEEDS_INPUT", percentage: null, basePercentage: payout.percentage, baseRuleCode: baseRule.ruleCode, missingFields: miss, adjustmentGroup: group, message: "Base payout matched, but an insurer adjustment may change the final payout. Complete the required field(s) to quote accurately." });
            adjustmentBlocked = true;
            break;
          }
        }
      }
      if (adjustmentBlocked) continue;
      if (adjustmentRules.length) {
        const finalPct = Number(((payout.percentage as number) + adjustmentPct).toFixed(4));
        if (!Number.isFinite(finalPct) || finalPct < 0 || finalPct > 100) {
          companyResults.push({ companyCode: company.code, companyName: company.name, status: "MANUAL_REVIEW", percentage: null, reason: `Final percentage ${finalPct} is outside 0-100.` });
          continue;
        }
        payout = evaluatePayout({ ...baseResult, percentage: finalPct }, policy);
      }
    }

    companyResults.push({
      companyCode: company.code,
      companyName: company.name,
      status: "MATCHED",
      percentage: payout.percentage,
      percentageDisplay: payout.percentageDisplay,
      basis: payout.basis,
      basisAmount: payout.basisAmount,
      commissionAmount: payout.commissionAmount,
      payoutComponents: payout.payoutComponents,
      ...gridInfo(gridMap, baseRule),
      ruleCode: baseRule.ruleCode,
      matchedCluster: policy.uwCluster ?? policy.geoCluster ?? policy.rtoCluster ?? null,
      source: baseRule.source,
      percentageAudit: sourceAudit(baseRule, baseGrid),
      percentageComponents: payout.composite ? undefined : {
        base: Number(baseResult.percentage),
        incremental: adjustmentPct,
        final: payout.percentage,
        aggregation: adjustmentRules.length ? "BASE_PLUS_INCREMENTAL_PERCENTAGE_POINTS" : "BASE_ONLY",
        adjustmentRuleCode: adjustmentRules[0]?.ruleCode ?? null,
        adjustmentRuleCodes: adjustmentRules.map((r:any)=>r.ruleCode),
        adjustmentSources: adjustmentRules.map((r:any)=>r.source),
        adjustmentSource: adjustmentRules[0]?.source ?? null
      },
      derivations: derivation.applied,
      resolvedInputs: {
        rtoCode: policy.rtoCode ?? null,
        rtoState: policy.rtoState ?? null,
        rtoStateCode: policy.rtoStateCode ?? null,
        rtoRegion: policy.rtoRegion ?? null,
        rtoCluster: policy.rtoCluster ?? null,
        geoCluster: policy.geoCluster ?? null,
        uwCluster: policy.uwCluster ?? null,
        insurerContext: policy.insurerContext ?? {}
      }
    });
  }
    } catch (error) {
      console.error(`Commission evaluation failed for ${catalogCompany.code}:`, error);
      companyResults.push({
        companyCode: catalogCompany.code,
        companyName: catalogCompany.name,
        status: "ENGINE_ERROR",
        displayStatus: "ENGINE ERROR",
        percentage: null,
        message: error instanceof Error ? error.message : "Insurer evaluation failed",
        retryable: true
      });
    }
    const row = companyResults[0] || {
      companyCode: catalogCompany.code,
      companyName: catalogCompany.name,
      status: "ENGINE_ERROR",
      displayStatus: "ENGINE ERROR",
      percentage: null,
      message: "Insurer evaluation completed without a result row.",
      retryable: true
    };
    row.evaluationMs = Date.now() - startedAt;
    return row;
  });
  results.sort((a, b) => {
    if (a.status === "MATCHED" && b.status !== "MATCHED") return -1;
    if (a.status !== "MATCHED" && b.status === "MATCHED") return 1;
    if (a.status === "MATCHED" && b.status === "MATCHED") {
      const aa = typeof a.commissionAmount === "number" ? a.commissionAmount : null;
      const ba = typeof b.commissionAmount === "number" ? b.commissionAmount : null;
      if (aa !== null && ba !== null && aa !== ba) return ba - aa;
      if (aa !== null && ba === null) return -1;
      if (aa === null && ba !== null) return 1;
      return (b.percentage ?? -1) - (a.percentage ?? -1);
    }
    if (a.status === "NEEDS_INPUT" && b.status !== "NEEDS_INPUT") return -1;
    if (a.status !== "NEEDS_INPUT" && b.status === "NEEDS_INPUT") return 1;
    return String(a.companyName).localeCompare(String(b.companyName));
  });

  const filtered = applyFilters(results, input.filters);
  const best = results.find(r => r.status === "MATCHED") ?? null;
  return {
    evaluatedAt: date,
    product,
    inputValidation: validation,
    insurersChecked: companies.length,
    matchedInsurers: results.filter(r => r.status === "MATCHED").length,
    needsInput: results.filter(r => r.status === "NEEDS_INPUT").length,
    bestOffer: best,
    bestPayout: best,
    filteredCount: filtered.length,
    // `results` and `allResults` always contain every canonical insurer. Filters are
    // presentation-only and are returned separately so searching never loses data.
    results,
    allResults: results,
    filteredResults: filtered
  };
}
