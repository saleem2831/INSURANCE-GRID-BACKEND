import { CommissionBasis, ImportedCondition, ImportedRule, ImportedRuleKind } from "../types";
import { normalizeStateName } from "../../services/canonicalRto.service";

export function percentTokens(line: string): number[] {
  return [...String(line).matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map(m => Number(m[1])).filter(Number.isFinite);
}

export function pdfRule(args: {
  fileName: string; page: number; code: string; product: string; conditions?: ImportedCondition[];
  percentage?: number; basis?: CommissionBasis; priority?: number; kind?: ImportedRuleKind;
  originalText?: string; components?: Array<{ basis: CommissionBasis; percentage: number }>;
}): ImportedRule {
  return {
    ruleCode: args.code,
    product: args.product,
    priority: args.priority ?? 100,
    ruleKind: args.kind ?? "BASE",
    conditions: args.conditions ?? [],
    result: { type: "PAYOUT", percentage: args.percentage, basis: args.basis, components: args.components },
    source: { fileName: args.fileName, sheet: `PDF Page ${args.page}`, row: args.page, originalText: args.originalText || "" }
  };
}

export function pdfStatusRule(args: {
  fileName: string; page: number; code: string; product: string; conditions?: ImportedCondition[];
  type: "DECLINE"|"NO_BUSINESS"|"IRDA"|"COUNCIL_CALL"|"MANUAL_REVIEW";
  priority?: number; reason?: string; originalText?: string;
}): ImportedRule {
  return {
    ruleCode: args.code,
    product: args.product,
    priority: args.priority ?? 1000,
    ruleKind: "EXCLUSION",
    conditions: args.conditions ?? [],
    result: { type: args.type, reason: args.reason },
    source: { fileName: args.fileName, sheet: `PDF Page ${args.page}`, row: args.page, originalText: args.originalText || args.reason || "" }
  };
}

export function derivationRule(args: {
  fileName: string; page: number; code: string; product?: string; conditions: ImportedCondition[];
  setField: string; value: unknown; priority?: number; originalText?: string;
}): ImportedRule {
  return {
    ruleCode: args.code,
    product: args.product || "ALL",
    priority: args.priority ?? 500,
    ruleKind: "DERIVATION",
    conditions: args.conditions,
    result: { type: "DERIVE", setField: args.setField, value: args.value },
    source: { fileName: args.fileName, sheet: `PDF Page ${args.page}`, row: args.page, originalText: args.originalText || `${args.setField}=${String(args.value)}` }
  };
}

export function stateConditions(states: string[], field = "rtoState"): ImportedCondition[] {
  const clean = states.map(normalizeStateName).filter(Boolean);
  if (!clean.length) return [];
  return [{ field, operator: clean.length === 1 ? "EQUAL" : "IN", value: clean.length === 1 ? clean[0] : clean }];
}

export function stateOtherThan(states: string[], field = "rtoState"): ImportedCondition[] {
  const clean = states.map(normalizeStateName).filter(Boolean);
  return clean.length ? [{ field, operator: "NOT_IN", value: clean }] : [];
}

export function normalizeStateList(text: string): string[] {
  return String(text || "")
    .replace(/&/g, ",")
    .replace(/\band\b/gi, ",")
    .split(/[,;]+/)
    .map(x => normalizeStateName(x.replace(/\bSTATE\b/gi, "").trim()))
    .filter(x => x && !/^OTHER THAN/.test(x) && x !== "ALL STATES" && x !== "ALL");
}
