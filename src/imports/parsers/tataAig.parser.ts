import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedCondition, ImportedRule } from '../types';
import { clean, excelColumn, makePayoutRule, normalizePolicyType, pct, rangeConditions, rule, upper } from './helpers';

function tataAge(v: unknown): ImportedCondition[] {
  const s = upper(v).replace(/\s+/g, '');
  if (!s || s === 'ALL') return [];
  if (s === 'BRANDNEW' || s === 'NEW') return [{ field: 'vehicleAge', operator: 'EQUAL', value: 0 }];
  let m = s.match(/^>=([\d.]+)<=([\d.]+)$/); if (m) return [{ field: 'vehicleAge', operator: 'GTE', value: +m[1] }, { field: 'vehicleAge', operator: 'LTE', value: +m[2] }];
  m = s.match(/^>([\d.]+)$/); if (m) return [{ field: 'vehicleAge', operator: 'GT', value: +m[1] }];
  return [];
}

function fuelCondition(v: unknown): ImportedCondition[] {
  const s = upper(v);
  if (!s || s === 'ALL') return [];
  if (s.includes('OTHER THAN DIESEL')) return [{ field: 'fuelType', operator: 'NOT_IN', value: ['DIESEL', 'CNG', 'ELECTRIC'] }];
  return [{ field: 'fuelType', operator: 'EQUAL', value: s }];
}

function cvSegment(seg: string): { product: string; conditions: ImportedCondition[]; incrementalClass?: string } {
  const u = upper(seg);
  const c: ImportedCondition[] = [];
  if (u.startsWith('GCV')) {
    if (u.includes('3W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '3W' });
    else c.push(...rangeConditions('gvw', u.replace(/GCV/g, '')));
    return { product: 'GCV', conditions: c, incrementalClass: /(?:<=\s*7\.5|UPTO\s*7\.5)/.test(u) ? 'LCV' : 'MNHCV' };
  }
  if (u.startsWith('PCV')) {
    if (u.includes('3W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '3W' });
    else if (u.includes('2W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '2W' });
    else c.push({ field: 'vehicleType', operator: 'EQUAL', value: '4W' });
    if (u.includes('SCHOOL')) c.push({ field: 'vehicleUse', operator: 'EQUAL', value: 'SCHOOL' });
    else if (u.includes('NON SCHOOL')) c.push({ field: 'vehicleUse', operator: 'NOT_EQUAL', value: 'SCHOOL' });
    const seat = u.match(/(\d+)\s*TO\s*(\d+)/); if (seat) c.push({ field: 'seatingCapacity', operator: 'BETWEEN', value: [+seat[1], +seat[2]] });
    const gt = u.match(/>\s*(\d+)/); if (gt) c.push({ field: 'seatingCapacity', operator: 'GT', value: +gt[1] });
    if (u.includes('_CORPORATE')) c.push({ field: 'ownershipType', operator: 'EQUAL', value: 'CORPORATE' });
    if (u.includes('_INDIVIDUAL')) c.push({ field: 'ownershipType', operator: 'EQUAL', value: 'INDIVIDUAL' });
    return { product: 'PCV', conditions: c, incrementalClass: u.includes('BUS') ? 'BUS' : 'PCV' };
  }
  const vt = u.includes('HARVESTER') ? 'HARVESTER' : u.includes('TRACTOR') ? 'TRACTOR' : u.includes('TRAILER') ? 'TRAILER' : u.includes('TRADE ROAD') ? 'TRADE_ROAD_RISK' : 'MISC';
  return { product: 'GCV', conditions: [{ field: 'vehicleType', operator: 'EQUAL', value: vt }], incrementalClass: 'LCV' };
}

function parseBaseCv(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const headers = sheet.rows[0] || [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const seg = clean(r[0]); if (!seg) continue;
    const parsed = cvSegment(seg);
    for (let col = 5; col < headers.length; col++) {
      const geography = clean(headers[col]); if (!geography || r[col] === undefined || clean(r[col]) === '') continue;
      const conditions: ImportedCondition[] = [
        { field: 'geoCluster', operator: 'EQUAL', value: geography },
        ...parsed.conditions, ...fuelCondition(r[1]), ...tataAge(r[3])
      ];
      const ptype = normalizePolicyType(r[2]); if (ptype && ptype !== 'ALL') conditions.push({ field: 'policyType', operator: 'EQUAL', value: ptype });
      const rr = rule(ctx.fileName, sheet.name, i + 1, `TATA-${ctx.version}-CV-R${i + 1}-C${col + 1}`, parsed.product, conditions, r[col], 'GWP', 100, excelColumn(col));
      if (rr) rules.push(rr);
    }
  }
}

function parseBaseTw(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const headers = sheet.rows[0] || [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const segment = upper(r[0]); if (!segment) continue;
    for (let col = 4; col < headers.length; col++) {
      const geography = clean(headers[col]); if (!geography || r[col] === undefined || clean(r[col]) === '') continue;
      const conditions: ImportedCondition[] = [
        { field: 'geoCluster', operator: 'EQUAL', value: geography },
        { field: 'vehicleType', operator: 'EQUAL', value: segment.replace(/\s+/g, '_') },
        { field: 'businessType', operator: 'EQUAL', value: upper(r[1]) }
      ];
      const ptype = normalizePolicyType(r[2]); if (ptype && ptype !== 'ALL') conditions.push({ field: 'policyType', operator: 'EQUAL', value: ptype });
      const rr = rule(ctx.fileName, sheet.name, i + 1, `TATA-${ctx.version}-TW-R${i + 1}-C${col + 1}`, 'TWO_WHEELER', conditions, r[col], 'GWP', 100, excelColumn(col));
      if (rr) rules.push(rr);
    }
  }
}

function parsePrivateCar(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const headers = sheet.rows[0] || [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const segment = clean(r[0]); if (!segment) continue;
    for (let col = 5; col < headers.length; col++) {
      const geography = clean(headers[col]); if (!geography || r[col] === undefined || clean(r[col]) === '') continue;
      const conditions: ImportedCondition[] = [
        { field: 'geoCluster', operator: 'EQUAL', value: geography },
        { field: 'vehicleSegment', operator: 'EQUAL', value: upper(segment) },
        { field: 'businessType', operator: 'EQUAL', value: upper(r[1]) },
        ...fuelCondition(r[2])
      ];
      const ptype = normalizePolicyType(r[3]); if (ptype) conditions.push({ field: 'policyType', operator: 'EQUAL', value: ptype });
      const rr = rule(ctx.fileName, sheet.name, i + 1, `TATA-${ctx.version}-PC-R${i + 1}-C${col + 1}`, 'PRIVATE_CAR', conditions, r[col], 'GWP', 100, excelColumn(col));
      if (rr) rules.push(rr);
    }
  }
}

function gwpRange(text: unknown): ImportedCondition[] {
  const s = upper(text).replace(/,/g, '').replace(/\s+/g, '');
  if (s.includes('10L') && s.includes('ABOVE')) return [{ field: 'businessMetrics.monthlyGwp', operator: 'GTE', value: 1000000 }];
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length >= 2) return [{ field: 'businessMetrics.monthlyGwp', operator: 'BETWEEN', value: [nums[0], nums[1]] }];
  return [];
}

function parseIncremental(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  // CV side: A-C, rows 3 onward.
  for (let i = 2; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const klass = upper(r[0]); const slab = clean(r[1]); const n = pct(r[2]);
    if (klass && slab && n !== null) {
      let product = klass === 'PCV' || klass === 'BUS' ? 'PCV' : 'GCV';
      rules.push(makePayoutRule(ctx.fileName, sheet.name, i + 1, `TATA-${ctx.version}-INC-CV-R${i + 1}`, product,
        [{ field: 'tataIncrementalClass', operator: 'EQUAL', value: klass }, ...gwpRange(slab)], n, 'GWP', 50, 'C', clean(r[2]), 'ADJUSTMENT'));
    }
    // TW side: E-F shares the first five populated slab rows.
    const twSlab = clean(r[4]); const twN = pct(r[5]);
    if (twSlab && twN !== null) rules.push(makePayoutRule(ctx.fileName, sheet.name, i + 1, `TATA-${ctx.version}-INC-TW-R${i + 1}`, 'TWO_WHEELER',
      gwpRange(twSlab), twN, 'GWP', 50, 'F', clean(r[5]), 'ADJUSTMENT'));
  }
}

export function parseTataAigWorkbook(sheets: ExcelSheet[], ctx: { fileName: string; version: string }): GridImportResult {
  const rules: ImportedRule[] = [];
  const cv = sheets.find(s => s.name === 'CV'); if (cv) parseBaseCv(cv, ctx, rules);
  const tw = sheets.find(s => s.name === 'TW'); if (tw) parseBaseTw(tw, ctx, rules);
  const pc = sheets.find(s => s.name === 'Sheet1'); if (pc) parsePrivateCar(pc, ctx, rules);
  const inc = sheets.find(s => s.name === 'Incremental Rule'); if (inc) parseIncremental(inc, ctx, rules);
  return {
    insurerCode: 'TATA_AIG', fileName: ctx.fileName, rules, rtoMappings: [],
    warnings: [
      'Tata AIG V4 imports CV, TW, Private Car TP, and the Incremental Rule sheet. Incremental values are stored separately as ADJUSTMENT rules and the comparison response exposes base + incremental components.',
      'The source uses geography columns rather than an RTO-code map. V4 auto-resolves geography only when state/location uniquely identifies a source column; otherwise it requests geoCluster instead of guessing.'
    ],
    errors: rules.length ? [] : ['No Tata AIG executable rules detected']
  };
}
