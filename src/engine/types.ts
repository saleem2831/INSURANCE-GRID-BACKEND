export type RuleOperator =
  | "EQUAL"
  | "NOT_EQUAL"
  | "IN"
  | "NOT_IN"
  | "BETWEEN"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "EXISTS";

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: unknown;
}

export interface MatchDetail {
  field: string;
  operator: RuleOperator;

  actualValue: unknown;
  expectedValue: unknown;

  matched: boolean;
}

export interface RuleMatchResult {
  matched: boolean;
  details: MatchDetail[];
}