import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedCondition, ImportedRule } from '../types';
import { ageConditions, clean, excelColumn, inferBasis, nopConditions, normalizePolicyType, normalizeRto, rangeConditions, result, rule, upper } from './helpers';

function normalizeState(v: unknown) {
  return upper(v).replace('UTTARANCHAL', 'UTTARAKHAND').replace('CHATTISGARH', 'CHHATTISGARH');
}

function productAndConditions(text: unknown): { product: string; conditions: ImportedCondition[] } {
  const u = upper(text); const c: ImportedCondition[] = [];
  if (u.includes('PRIVATE CAR')) {
    if (u.includes('PETROL')) c.push({ field: 'fuelType', operator: 'EQUAL', value: 'PETROL' });
    if (u.includes('DIESEL')) c.push({ field: 'fuelType', operator: 'EQUAL', value: 'DIESEL' });
    return { product: 'PRIVATE_CAR', conditions: c };
  }
  if (u.includes('PCCV')) {
    if (u.includes('3W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '3W' });
    if (u.includes('4W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '4W' });
    if (u.includes('SCHOOL')) c.push({ field: 'vehicleUse', operator: 'EQUAL', value: 'SCHOOL' });
    if (u.includes('DIESEL') && !u.includes('OTHER THAN DIESEL')) c.push({ field: 'fuelType', operator: 'EQUAL', value: 'DIESEL' });
    if (u.includes('OTHER THAN DIESEL')) c.push({ field: 'fuelType', operator: 'NOT_EQUAL', value: 'DIESEL' });
    if (u.includes('E-RICKSHAW') || u.includes('E CART')) c.push({ field: 'fuelType', operator: 'EQUAL', value: 'ELECTRIC' });
    let m = u.match(/UPTO\s*(\d+)\+?1?/); if (m && u.includes('4W')) c.push({ field: 'seatingCapacity', operator: 'LTE', value: +m[1] + (u.includes('+1') ? 1 : 0) });
    m = u.match(/(\d+)\s*TO\s*(\d+)/); if (m && u.includes('4W')) c.push({ field: 'seatingCapacity', operator: 'BETWEEN', value: [+m[1], +m[2]] });
    return { product: 'PCV', conditions: c };
  }
  if (u.includes('2W')) return { product: 'TWO_WHEELER', conditions: c };
  if (u.includes('TRACTOR')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'TRACTOR' });
  else if (u.includes('MISC')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'MISC_D' });
  else if (u.includes('3W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '3W' });
  else c.push(...rangeConditions('gvw', u));
  return { product: 'GCV', conditions: c };
}

function policyConditions(v: unknown): ImportedCondition[] {
  const u = upper(v).replace(/\s+/g, '');
  if (!u) return [];
  if (u.includes('P&L')) return [{ field: 'policyType', operator: 'IN', value: ['COMP', 'LIABILITY'] }];
  if (u.includes('P&SA-OD') || u.includes('P&SAOD')) return [{ field: 'policyType', operator: 'IN', value: ['COMP', 'SAOD'] }];
  const p = normalizePolicyType(v); return p && p !== 'ALL' ? [{ field: 'policyType', operator: 'EQUAL', value: p }] : [];
}

function discountConditions(v: unknown): ImportedCondition[] {
  const s = upper(v).replace(/%/g, '').trim(); if (!s) return [];
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (/\bTO\b|-/.test(s) && nums.length >= 2) return [{ field: 'odDiscountPercent', operator: 'BETWEEN', value: [nums[0], nums[1]] }];
  if (nums.length === 1) return [{ field: 'odDiscountPercent', operator: 'EQUAL', value: nums[0] }];
  return [];
}

function remarkConditions(text: unknown): { conditions: ImportedCondition[]; safe: boolean } {
  const raw = clean(text), u = upper(raw); const c: ImportedCondition[] = [];
  if (!u) return { conditions: c, safe: true };
  if (/WITHOUT\s+NCB|NON[-\s]*NCB/.test(u)) c.push({ field: 'ncb', operator: 'EQUAL', value: 0 });
  else if (/NCB\s*(?:CASES?|ONLY)/.test(u) || /WITH\s+NCB/.test(u)) c.push({ field: 'ncb', operator: 'GT', value: 0 });
  let m = u.match(/NCB\s*(?:=>|>=)\s*(\d+)/); if (m) c.push({ field: 'ncb', operator: 'GTE', value: +m[1] });
  m = u.match(/NCB\s*(?:=<|<=)\s*(\d+)/); if (m) c.push({ field: 'ncb', operator: 'LTE', value: +m[1] });
  m = u.match(/UPTO\s*(\d+)\s*CC/); if (m) c.push({ field: 'cc', operator: 'LTE', value: +m[1] });
  m = u.match(/(?:ABOVE|GREATER THAN)\s*(\d+)\s*CC/); if (m) c.push({ field: 'cc', operator: 'GT', value: +m[1] });

  const knownMakes = ['HONDA','HYUNDAI','KIA','MARUTI SUZUKI','MARUTI','M&M','MAHINDRA','RENAULT','CITROEN'];
  const mentioned = knownMakes.filter(x => u.includes(x));
  if ((u.includes('ONLY') || u.includes('MANF ONLY') || u.includes('MANUFACTURE ONLY')) && mentioned.length) c.push({ field: 'make', operator: 'IN', value: mentioned });
  else if ((u.includes('EXCEPT') || u.includes('EXCLUDING')) && mentioned.length) c.push({ field: 'make', operator: 'NOT_IN', value: mentioned });

  // These phrases materially alter eligibility but are not represented by the
  // minimum user input matrix. Do not silently ignore them.
  const unsupported = ['IDV', 'ADD ON', 'BRANCH', 'TR RTO', 'SHORT TERM', 'PRO RATA', 'BREAK-IN'];
  const unsafe = unsupported.some(x => u.includes(x));
  return { conditions: c, safe: !unsafe };
}

function addGsRules(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const productText = clean(r[2]); const pay = r[5]; if (!productText || pay === undefined || clean(pay) === '') continue;
    const parsed = productAndConditions(productText); const remark = remarkConditions(r[8]);
    const conditions: ImportedCondition[] = [
      { field: 'rtoState', operator: 'EQUAL', value: normalizeState(r[1]) },
      ...parsed.conditions, ...nopConditions(r[3]), ...discountConditions(r[4]), ...policyConditions(r[6]), ...ageConditions(r[7]), ...remark.conditions
    ];
    if (!remark.safe) {
      rules.push({
        ruleCode: `SHR-${ctx.version}-R${i + 1}`, product: parsed.product, priority: 110, ruleKind: 'BASE', conditions,
        result: { type: 'MANUAL_REVIEW', reason: `Source remark contains an additional eligibility qualifier that is not safely automated: ${clean(r[8])}` },
        source: { fileName: ctx.fileName, sheet: sheet.name, row: i + 1, column: excelColumn(5), originalText: `${clean(pay)} | ${clean(r[8])}` }
      });
      continue;
    }
    const rr = rule(ctx.fileName, sheet.name, i + 1, `SHR-${ctx.version}-R${i + 1}`, parsed.product, conditions, pay, inferBasis(pay, 'GWP'), 110, excelColumn(5));
    if (rr) rules.push(rr);
  }
}

function addDeclines(sheets: ExcelSheet[], ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const d = sheets.find(s => s.name === 'Declined-Excluded');
  if (d) for (let i = 2; i < d.rows.length; i++) {
    const r = d.rows[i] || []; const code = normalizeRto(r[2]); if (!/^[A-Z]{2}-\d{2}$/.test(code)) continue;
    const parsed = productAndConditions(r[0]);
    rules.push({ ruleCode: `SHR-${ctx.version}-DECL-R${i + 1}`, product: parsed.product, priority: 9000, ruleKind: 'EXCLUSION',
      conditions: [{ field: 'rtoCode', operator: 'EQUAL', value: code }, ...parsed.conditions], result: { type: 'DECLINE', reason: clean(r[4]) || 'Declined RTO' },
      source: { fileName: ctx.fileName, sheet: d.name, row: i + 1, originalText: `${clean(r[0])} | ${code} | ${clean(r[4])}` } });
  }
  const pan = sheets.find(s => s.name === 'PAN India');
  if (pan) for (let i = 2; i < pan.rows.length; i++) {
    const r = pan.rows[i] || []; const code = normalizeRto(r[0]); if (!/^[A-Z]{2}-\d{2}$/.test(code)) continue;
    // PAN India rows apply broadly; specific listed exceptions are left as a source note.
    rules.push({ ruleCode: `SHR-${ctx.version}-PANDECL-R${i + 1}`, product: 'ALL', priority: 8500, ruleKind: 'EXCLUSION',
      conditions: [{ field: 'rtoCode', operator: 'EQUAL', value: code }], result: { type: 'DECLINE', reason: clean(r[3]) || 'PAN India declined RTO' },
      source: { fileName: ctx.fileName, sheet: pan.name, row: i + 1, originalText: `${code} | ${clean(r[3])}` } });
  }
}

export function parseShriramWorkbook(sheets: ExcelSheet[], ctx: { fileName: string; version: string }): GridImportResult {
  const rules: ImportedRule[] = []; const gs = sheets.find(s => s.name === 'G.S'); if (gs) addGsRules(gs, ctx, rules); addDeclines(sheets, ctx, rules);
  return { insurerCode: 'SHRIRAM', fileName: ctx.fileName, rules, rtoMappings: [],
    warnings: [
      'Shriram V4 parses product, state, NOP slab, OD discount %, payout basis, policy type, age, common NCB/make/CC remarks and declined RTO lists.',
      'Rows with additional source qualifiers such as IDV/add-on/branch restrictions are deliberately returned as MANUAL_REVIEW rather than quoted without the missing underwriting input.'
    ], errors: rules.length ? [] : ['No Shriram executable rules detected'] };
}
