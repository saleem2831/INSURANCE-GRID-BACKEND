import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedRule } from '../types';
import { clean, excelColumn, rule, upper } from './helpers';

export function parseIndusindWorkbook(sheets: ExcelSheet[], ctx: { fileName: string; version: string }): GridImportResult {
  const rules: ImportedRule[] = []; const sh = sheets[0];
  if (!sh) return { insurerCode: 'INDUSIND', fileName: ctx.fileName, rules: [], rtoMappings: [], warnings: [], errors: ['No sheet found'] };
  for (let i = 1; i < sh.rows.length; i++) {
    const r = sh.rows[i] || []; const zone = clean(r[0]), region = clean(r[1]); if (!region) continue;
    const defs = [
      ['ROLLOVER', 'LT', 10, 2], ['ROLLOVER', 'GTE', 10, 3],
      ['RENEWAL', 'LT', 10, 4], ['RENEWAL', 'GTE', 10, 5]
    ] as const;
    for (const [biz, op, age, col] of defs) {
      const rr = rule(ctx.fileName, sh.name, i + 1, `IND-${ctx.version}-R${i + 1}-C${col + 1}`, 'PCV', [
        { field: 'rtoRegion', operator: 'EQUAL', value: upper(region) },
        { field: 'businessType', operator: 'EQUAL', value: biz },
        { field: 'vehicleUse', operator: 'EQUAL', value: 'SCHOOL' },
        { field: 'vehicleAge', operator: op, value: age }
      ], r[col], 'GWP', 100, excelColumn(col));
      if (rr) rules.push(rr);
    }
  }
  return { insurerCode: 'INDUSIND', fileName: ctx.fileName, rules, rtoMappings: [],
    warnings: ['IndusInd school-bus rules use RTO region, business type and the <10 / >=10 vehicle-age split exactly as supplied. V4 resolves region from RTO state/location when unique; otherwise it requests rtoRegion.'],
    errors: rules.length ? [] : ['No IndusInd rules detected'] };
}
