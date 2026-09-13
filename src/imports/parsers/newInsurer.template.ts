/** Copy this file when onboarding a brand-new insurer. */
import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedRule, ImportedRtoMapping } from '../types';

export function parseNewInsurerWorkbook(
  sheets: ExcelSheet[],
  context: { fileName: string; version: string }
): GridImportResult {
  const rules: ImportedRule[] = [];
  const rtoMappings: ImportedRtoMapping[] = [];

  // 1. Locate expected sheets by name/header.
  // 2. Convert every executable payout cell into ImportedRule.
  // 3. Convert RTO/cluster tables into ImportedRtoMapping where available.
  // 4. Preserve sheet/row/originalText for auditability.
  // 5. Return MANUAL_REVIEW for expressions that cannot be interpreted safely.

  return {
    insurerCode: 'NEW_INSURER',
    fileName: context.fileName,
    rules,
    rtoMappings,
    warnings: [],
    errors: rules.length ? [] : ['No executable rules detected; implement this parser before commit.']
  };
}
