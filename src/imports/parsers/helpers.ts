import { ImportedCondition, ImportedRule, ImportResultType, CommissionBasis, ImportedRuleKind } from '../types';

export const clean = (v: unknown) => String(v ?? '').replace(/\u00a0/g, ' ').trim();
export const upper = (v: unknown) => clean(v).toUpperCase().replace(/\s+/g, ' ');
export const slug = (v: unknown) => upper(v).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export const excelColumn = (zeroBased: number) => {
  let n = zeroBased + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

export const pct = (v: unknown): number | null => {
  const s = clean(v).replace(/%/g, '').replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
};

export function inferBasis(v: unknown, fallback: CommissionBasis = 'GWP'): CommissionBasis {
  const s = upper(v);
  if (/\bNET\b/.test(s)) return 'NET';
  if (/\bOD\b/.test(s)) return 'OD';
  if (/\bTP\b/.test(s) && !/SATP/.test(s)) return 'TP';
  return fallback;
}

export function result(v: unknown, basis: CommissionBasis = 'GWP'):
  { type: ImportResultType; percentage?: number; basis?: CommissionBasis; reason?: string } | null {
  const s = upper(v);
  if (!s || s === 'NA' || s === 'N/A' || s === '-' || s === 'NOT APPLICABLE') return null;
  if (s.includes('NO BIZ') || s.includes('NO BUSINESS')) return { type: 'NO_BUSINESS' };
  if (s.includes('DECLINE') || s === 'D' || s === 'DECLINED' || s.includes('BLOCK')) return { type: 'DECLINE' };
  if (s === 'IRDA') return { type: 'IRDA' };
  if (s === 'CC' || s === 'COUNCIL CALL') return { type: 'COUNCIL_CALL' };

  // Accept a single numeric token even when the source appends OD/NET text.
  const nums = clean(v).match(/-?\d+(?:\.\d+)?/g) || [];
  if (nums.length === 1) {
    const n = pct(nums[0]);
    if (n !== null) return { type: 'PAYOUT', percentage: n, basis: inferBasis(v, basis) };
  }

  const n = pct(v);
  if (n !== null) return { type: 'PAYOUT', percentage: n, basis };
  return { type: 'MANUAL_REVIEW', reason: `Complex/unrecognized source expression: ${clean(v)}` };
}

export function rule(
  fileName: string,
  sheet: string,
  row: number,
  code: string,
  product: string,
  conditions: ImportedCondition[],
  v: unknown,
  basis: CommissionBasis = 'GWP',
  priority = 100,
  column?: string,
  ruleKind: ImportedRuleKind = 'BASE'
): ImportedRule | null {
  const r = result(v, inferBasis(v, basis));
  if (!r) return null;
  return {
    ruleCode: code,
    product,
    priority,
    ruleKind: r.type === 'PAYOUT' ? ruleKind : 'EXCLUSION',
    conditions,
    result: r,
    source: { fileName, sheet, row, column, originalText: clean(v) }
  };
}

export function makePayoutRule(
  fileName: string,
  sheet: string,
  row: number,
  code: string,
  product: string,
  conditions: ImportedCondition[],
  percentage: number,
  basis: CommissionBasis = 'GWP',
  priority = 100,
  column?: string,
  originalText?: string,
  ruleKind: ImportedRuleKind = 'BASE'
): ImportedRule {
  return {
    ruleCode: code,
    product,
    priority,
    ruleKind,
    conditions,
    result: { type: 'PAYOUT', percentage, basis },
    source: { fileName, sheet, row, column, originalText: originalText ?? String(percentage) }
  };
}

export function ageConditions(text: unknown, field = 'vehicleAge'): ImportedCondition[] {
  const s = upper(text).replace(/YEARS?|YRS?\.?/g, '').trim();
  if (!s || s === 'ALL') return [];
  if (s.includes('BRAND NEW') || s === 'NEW' || s === '0') return [{ field, operator: 'EQUAL', value: 0 }];
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:TO|-)\s*(\d+(?:\.\d+)?)/);
  if (m) return [{ field, operator: 'BETWEEN', value: [Number(m[1]), Number(m[2])] }];
  m = s.match(/(?:ABOVE|>|>=|GREATER THAN)\s*(\d+(?:\.\d+)?)/);
  if (m) return [{ field, operator: s.includes('>=') ? 'GTE' : 'GT', value: Number(m[1]) }];
  m = s.match(/(?:BELOW|<|<=|UPTO)\s*(\d+(?:\.\d+)?)/);
  if (m) return [{ field, operator: s.includes('<=') || s.includes('UPTO') ? 'LTE' : 'LT', value: Number(m[1]) }];
  m = s.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (m) return [{ field, operator: 'GTE', value: Number(m[1]) }];
  if (/^\d+(?:\.\d+)?$/.test(s)) return [{ field, operator: 'EQUAL', value: Number(s) }];
  return [{ field: `${field}Band`, operator: 'EQUAL', value: clean(text) }];
}

function unitMultiplier(s: string): number {
  if (/\b(?:T|TON|TONNE|TONS)\b/.test(s)) return 1000;
  return 1;
}

export function rangeConditions(field: string, text: unknown): ImportedCondition[] {
  let s = upper(text).replace(/,/g, '');
  if (!s) return [];
  const multiplier = unitMultiplier(s);
  // Avoid treating age numbers embedded in a segment as GVW when the segment contains explicit age language.
  s = s.replace(/\b(?:AGE|YEARS?|YRS?)\b.*$/g, '').trim();
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const cv = (n: number) => n * multiplier;
  if ((s.includes('UPTO') || s.includes('<=') || /^\s*</.test(s)) && nums.length === 1)
    return [{ field, operator: 'LTE', value: cv(nums[0]) }];
  if ((s.includes('ABOVE') || s.includes('GREATER THAN') || /^\s*>/.test(s)) && nums.length === 1)
    return [{ field, operator: 'GT', value: cv(nums[0]) }];
  if (nums.length >= 2) {
    const lo = cv(nums[0]), hi = cv(nums[1]);
    const lowInclusive = /(?:>=|FROM|UPTO)/.test(s) || /^\s*\d/.test(s);
    return [
      { field, operator: lowInclusive ? 'GTE' : 'GT', value: lo },
      { field, operator: 'LTE', value: hi }
    ];
  }
  return [];
}

export function moneySlabConditions(text: unknown, field = 'businessMetrics.monthlyGwp'): ImportedCondition[] {
  const raw = upper(text).replace(/\s+/g, '');
  if (!raw) return [];
  const tokens = [...raw.matchAll(/(\d+(?:\.\d+)?)(L|LAC|LAKH|K)?/g)].map(m => {
    const n = Number(m[1]);
    const u = m[2] || '';
    return n * (u.startsWith('L') ? 100000 : u === 'K' ? 1000 : 1);
  });
  if (!tokens.length) return [];
  if ((raw.includes('UPTO') || raw.startsWith('<=') || raw.startsWith('<')) && tokens.length === 1)
    return [{ field, operator: raw.startsWith('<') && !raw.startsWith('<=') ? 'LT' : 'LTE', value: tokens[0] }];
  if ((raw.startsWith('>') || raw.includes('ABOVE')) && tokens.length === 1)
    return [{ field, operator: 'GT', value: tokens[0] }];
  if (tokens.length >= 2)
    return [{ field, operator: 'GT', value: tokens[0] }, { field, operator: 'LTE', value: tokens[1] }];
  return [];
}

export function nopConditions(text: unknown, field = 'businessMetrics.nop'): ImportedCondition[] {
  const s = upper(text);
  if (!s) return [];
  const nums = (s.match(/\d+/g) || []).map(Number);
  if (/\d+\s*(?:TO|-)\s*\d+/.test(s) && nums.length >= 2) return [{ field, operator: 'BETWEEN', value: [nums[0], nums[1]] }];
  if ((s.includes('& ABOVE') || s.includes('ABOVE') || s.includes('+')) && nums.length) return [{ field, operator: 'GTE', value: nums[0] }];
  if (nums.length === 1) return [{ field, operator: 'EQUAL', value: nums[0] }];
  return [];
}

export function normalizePolicyType(v: unknown): string {
  const s = upper(v).replace(/\s+/g, '');
  if (!s || s === 'ALL') return '';
  if (s.includes('SA-OD') || s.includes('SAOD')) return 'SAOD';
  if (s.includes('SATP') || s === 'TP' || s.includes('AOTP')) return s.includes('AOTP') ? 'AOTP' : 'SATP';
  if (s.includes('BUNDLE') && s.includes('1+3')) return 'COMP_1_3';
  if (s.includes('BUNDLE') && s.includes('3+3')) return 'COMP_3_3';
  if (s.includes('1+5')) return 'COMP_1_5';
  if (s.includes('1+1')) return 'COMP_1_1';
  if (s === 'P' || s.includes('PACKAGE') || s.includes('COMPREHENSIVE') || s === 'COMP') return 'COMP';
  if (s === 'L') return 'LIABILITY';
  if (s.includes('P&L') || s.includes('P&L')) return 'ALL';
  return upper(v);
}

export function normalizeRto(v: unknown): string {
  const raw = upper(v).replace(/\s+/g, '').replace(/[_/]+/g, '-').replace(/--+/g, '-');
  const compact = raw.replace(/-/g, '');
  const m = compact.match(/^([A-Z]{2})([A-Z0-9]{1,8})$/);
  if (!m) return raw;
  const state = m[1];
  const rest = m[2];
  const n = rest.match(/^(\d{1,3})([A-Z0-9]*)$/);
  if (n) return `${state}-${n[1].length === 1 ? n[1].padStart(2,'0') : n[1]}${n[2] || ''}`;
  return `${state}-${rest}`;
}
