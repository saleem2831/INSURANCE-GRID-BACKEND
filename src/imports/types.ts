import { RuleOperator } from "../engine/types";

export type ImportResultType =
  | "PAYOUT"
  | "DECLINE"
  | "NO_BUSINESS"
  | "IRDA"
  | "COUNCIL_CALL"
  | "MANUAL_REVIEW"
  | "DERIVE";

export type CommissionBasis =
  | "OD"
  | "TP"
  | "NET"
  | "GROSS"
  | "GWP"
  | "OD_TP"
  | "FIXED";

export type ImportedRuleKind = "DERIVATION" | "BASE" | "ADJUSTMENT" | "OVERRIDE" | "EXCLUSION";

export interface ImportedCondition {
  field: string;
  operator: RuleOperator;
  value?: unknown;
}

export interface ImportedRule {
  ruleCode: string;
  product: string;
  priority: number;
  ruleKind?: ImportedRuleKind;
  ruleGroup?: string;
  conditions: ImportedCondition[];
  result: {
    type: ImportResultType;
    percentage?: number;
    basis?: CommissionBasis;
    fixedAmount?: number;
    reason?: string;
    setField?: string;
    value?: unknown;
    components?: Array<{ basis: CommissionBasis; percentage: number }>;
  };
  source: {
    fileName: string;
    sheet: string;
    row: number;
    column?: string;
    originalText?: string;
  };
}

export interface ImportedRtoMapping {
  rtoCode: string;
  originalRtoCode?: string;
  product: string;
  cluster: string;
  region?: string;
  state?: string;
  location?: string;
  subCluster?: string;
  actuarialCluster?: string;
  mappingClass?: string;
  metadata?: Record<string, unknown>;
  source: {
    fileName?: string;
    sheet: string;
    row: number;
  };
}

export interface GridImportResult {
  insurerCode: string;
  fileName: string;
  rules: ImportedRule[];
  rtoMappings: ImportedRtoMapping[];
  warnings: string[];
  errors: string[];
}
