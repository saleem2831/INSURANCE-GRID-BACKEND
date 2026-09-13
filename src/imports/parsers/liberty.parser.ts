import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedCondition, ImportedRule } from '../types';
import { ageConditions, clean, excelColumn, moneySlabConditions, rangeConditions, rule, upper } from './helpers';

function geo(v: unknown) { return clean(v); }

function productConditions(label: string): { product: string; conditions: ImportedCondition[] } {
  const u = upper(label);
  if (u.includes('PCV 3W')) return { product: 'PCV', conditions: [{ field: 'vehicleType', operator: 'EQUAL', value: '3W' }] };
  if (u.includes('GCV 3W')) return { product: 'GCV', conditions: [{ field: 'vehicleType', operator: 'EQUAL', value: '3W' }] };
  if (u.includes('TRACTOR')) return { product: 'GCV', conditions: [{ field: 'vehicleType', operator: 'EQUAL', value: 'TRACTOR' }] };
  return { product: 'GCV', conditions: rangeConditions('gvw', label) };
}

function ageBandForColumn(col: number, start: number, width: number, labels: string[]): ImportedCondition[] {
  const idx = Math.floor((col - start) / width);
  return ageConditions(labels[idx] || '');
}

function addRule(
  rules: ImportedRule[], ctx: { fileName: string; version: string }, sheet: ExcelSheet,
  rowIndex: number, col: number, product: string, conditions: ImportedCondition[], value: unknown,
  priority = 100
) {
  const rr = rule(ctx.fileName, sheet.name, rowIndex + 1,
    `LIB-${ctx.version}-${sheet.name.replace(/[^A-Z0-9]+/gi, '').slice(0, 18)}-R${rowIndex + 1}-C${col + 1}`,
    product, conditions, value, 'GWP', priority, excelColumn(col));
  if (rr) rules.push(rr);
}

function parsePcTw(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  let carryGeo = '';
  for (let i = 3; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || [];
    if (clean(r[0])) carryGeo = geo(r[0]);
    const volume = clean(r[3]);
    if (!carryGeo || !volume) continue;
    const common: ImportedCondition[] = [
      { field: 'geoCluster', operator: 'EQUAL', value: carryGeo },
      ...moneySlabConditions(volume)
    ];
    const defs: Array<[number, string, ImportedCondition[]]> = [
      [4, 'PRIVATE_CAR', [{ field: 'policyType', operator: 'EQUAL', value: 'COMP' }, { field: 'fuelType', operator: 'EQUAL', value: 'PETROL' }]],
      [5, 'PRIVATE_CAR', [{ field: 'policyType', operator: 'EQUAL', value: 'COMP' }, { field: 'fuelType', operator: 'EQUAL', value: 'DIESEL' }]],
      [6, 'PRIVATE_CAR', [{ field: 'policyType', operator: 'EQUAL', value: 'SAOD' }, { field: 'ncb', operator: 'GT', value: 0 }]],
      [7, 'PRIVATE_CAR', [{ field: 'policyType', operator: 'EQUAL', value: 'SAOD' }, { field: 'ncb', operator: 'EQUAL', value: 0 }]],
      [8, 'TWO_WHEELER', [{ field: 'vehicleType', operator: 'EQUAL', value: 'BIKE' }, { field: 'policyType', operator: 'EQUAL', value: 'COMP_1_1' }]],
      [9, 'TWO_WHEELER', [{ field: 'vehicleType', operator: 'EQUAL', value: 'BIKE' }, { field: 'policyType', operator: 'EQUAL', value: 'SAOD' }]],
      [10, 'TWO_WHEELER', [{ field: 'vehicleType', operator: 'EQUAL', value: 'SCOOTER' }, { field: 'policyType', operator: 'EQUAL', value: 'COMP_1_1' }]],
      [11, 'TWO_WHEELER', [{ field: 'vehicleType', operator: 'EQUAL', value: 'SCOOTER' }, { field: 'policyType', operator: 'EQUAL', value: 'SAOD' }]]
    ];
    for (const [col, product, extra] of defs) addRule(rules, ctx, sheet, i, col, product, [...common, ...extra], r[col]);
  }
}

function parseCvUnder75(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const headers = sheet.rows[2] || [];
  let carryGeo = '';
  let carrySatpGeo = '';
  for (let i = 3; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || [];
    if (clean(r[0])) carryGeo = geo(r[0]);
    if (clean(r[25])) carrySatpGeo = geo(r[25]);
    const compVolume = clean(r[1]);
    if (carryGeo && compVolume) {
      for (let col = 4; col <= 23; col++) {
        const seg = clean(headers[col]); if (!seg) continue;
        const parsed = productConditions(seg);
        const conditions: ImportedCondition[] = [
          { field: 'geoCluster', operator: 'EQUAL', value: carryGeo },
          ...moneySlabConditions(compVolume),
          { field: 'policyType', operator: 'EQUAL', value: 'COMP' },
          ...ageBandForColumn(col, 4, 5, ['NEW', '>1 TO 5', '>5 TO 10', '>10']),
          ...parsed.conditions
        ];
        addRule(rules, ctx, sheet, i, col, parsed.product, conditions, r[col]);
      }
    }
    const satpVolume = clean(r[26]);
    const sg = carrySatpGeo || carryGeo;
    if (sg && satpVolume) {
      for (let col = 27; col <= 46; col++) {
        const seg = clean(headers[col]); if (!seg) continue;
        const parsed = productConditions(seg);
        const conditions: ImportedCondition[] = [
          { field: 'geoCluster', operator: 'EQUAL', value: sg },
          ...moneySlabConditions(satpVolume),
          { field: 'policyType', operator: 'EQUAL', value: 'SATP' },
          ...ageBandForColumn(col, 27, 5, ['NEW', '>1 TO 5', '>5 TO 10', '>10']),
          ...parsed.conditions
        ];
        addRule(rules, ctx, sheet, i, col, parsed.product, conditions, r[col]);
      }
    }
  }
}

function parseCvAbove75(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const headers = sheet.rows[4] || [];
  let compGeo = '', satpGeo = '';
  for (let i = 5; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || [];
    if (clean(r[0])) compGeo = geo(r[0]);
    if (clean(r[21])) satpGeo = geo(r[21]);
    const compVolume = clean(r[1]);
    if (compGeo && compVolume) {
      for (let col = 4; col <= 19; col++) {
        const seg = clean(headers[col]); if (!seg) continue;
        const parsed = productConditions(seg);
        const conditions: ImportedCondition[] = [
          { field: 'geoCluster', operator: 'EQUAL', value: compGeo }, ...moneySlabConditions(compVolume),
          { field: 'policyType', operator: 'EQUAL', value: 'COMP' },
          ...ageBandForColumn(col, 4, 4, ['NEW', '>1 TO 5', '>5 TO 10', '>10']), ...parsed.conditions
        ];
        addRule(rules, ctx, sheet, i, col, parsed.product, conditions, r[col]);
      }
    }
    const satpVolume = clean(r[22]);
    const sg = satpGeo || compGeo;
    if (sg && satpVolume) {
      for (let col = 23; col <= 34; col++) {
        const seg = clean(headers[col]); if (!seg) continue;
        const parsed = productConditions(seg);
        const conditions: ImportedCondition[] = [
          { field: 'geoCluster', operator: 'EQUAL', value: sg }, ...moneySlabConditions(satpVolume),
          { field: 'policyType', operator: 'EQUAL', value: 'SATP' },
          ...ageBandForColumn(col, 23, 3, ['NEW', '>1 TO 5', '>5 TO 10', '>10']), ...parsed.conditions
        ];
        addRule(rules, ctx, sheet, i, col, parsed.product, conditions, r[col]);
      }
    }
  }
}

function parsePcSatp(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  for (let i = 4; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const g = geo(r[0]); if (!g) continue;
    for (let col = 3; col <= 11; col++) {
      const fuel = col < 6 ? 'PETROL' : col < 9 ? 'DIESEL' : 'CNG';
      const pos = (col - 3) % 3;
      const cc = pos === 0 ? '<1000' : pos === 1 ? '1000-1500' : '>1500';
      addRule(rules, ctx, sheet, i, col, 'PRIVATE_CAR', [
        { field: 'geoCluster', operator: 'EQUAL', value: g },
        { field: 'policyType', operator: 'EQUAL', value: 'SATP' },
        { field: 'fuelType', operator: 'EQUAL', value: fuel }, ...rangeConditions('cc', cc)
      ], r[col]);
    }
  }
}

function parseTwSatp(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  const hdr = sheet.rows[3] || [];
  for (let i = 4; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const g = geo(r[0]); if (!g) continue;
    for (let col = 3; col <= 8; col++) {
      const type = col <= 6 ? 'BIKE' : 'SCOOTER';
      const band = clean(hdr[col]);
      addRule(rules, ctx, sheet, i, col, 'TWO_WHEELER', [
        { field: 'geoCluster', operator: 'EQUAL', value: g },
        { field: 'policyType', operator: 'EQUAL', value: 'SATP' },
        { field: 'vehicleType', operator: 'EQUAL', value: type }, ...rangeConditions('cc', band)
      ], r[col]);
    }
  }
}

function parseMisc(sheet: ExcelSheet, ctx: { fileName: string; version: string }, rules: ImportedRule[]) {
  for (let i = 3; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] || []; const g = geo(r[0]), slab = clean(r[1]); if (!g || !slab) continue;
    for (let col = 4; col <= 7; col++) {
      const age = ['NEW', '1 TO 5', '6 TO 10', '11+'][col - 4];
      addRule(rules, ctx, sheet, i, col, 'GCV', [
        { field: 'geoCluster', operator: 'EQUAL', value: g }, ...moneySlabConditions(slab),
        { field: 'vehicleType', operator: 'EQUAL', value: 'MISC_D' }, ...ageConditions(age)
      ], r[col]);
    }
  }
}

export function parseLibertyWorkbook(sheets: ExcelSheet[], ctx: { fileName: string; version: string }): GridImportResult {
  const rules: ImportedRule[] = [];
  const pcTw = sheets.find(s => s.name.includes('PC TW_Comp')); if (pcTw) parsePcTw(pcTw, ctx, rules);
  const cv1 = sheets.find(s => s.name === 'CV <7.5T Comp & SATP'); if (cv1) parseCvUnder75(cv1, ctx, rules);
  const cv2 = sheets.find(s => s.name === 'CV >7.5T Comp & SATP'); if (cv2) parseCvAbove75(cv2, ctx, rules);
  const pcSatp = sheets.find(s => s.name === 'PC SATP'); if (pcSatp) parsePcSatp(pcSatp, ctx, rules);
  const twSatp = sheets.find(s => s.name === 'TW SATP'); if (twSatp) parseTwSatp(twSatp, ctx, rules);
  const misc = sheets.find(s => s.name === 'Misc D (Ex Tractor)'); if (misc) parseMisc(misc, ctx, rules);
  return {
    insurerCode: 'LIBERTY', fileName: ctx.fileName, rules, rtoMappings: [],
    warnings: [
      'Liberty V4 imports PC/TW Comp & SAOD, PC SATP, TW SATP, CV <7.5T, CV >7.5T and Misc-D sheets.',
      'The supplied Liberty workbook does not contain an RTO-code to Geo Segment mapping. The comparison engine therefore asks for geoCluster only when the RTO cannot be uniquely mapped from source context; it never guesses between similarly named Liberty geo segments.'
    ],
    errors: rules.length ? [] : ['No Liberty executable rules detected']
  };
}
