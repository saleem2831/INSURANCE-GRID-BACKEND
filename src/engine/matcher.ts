import {
  RuleCondition,
  RuleMatchResult
} from "./types";

import { evaluateOperator } from "./operators";

/**
 * Supports nested fields:
 *
 * extraData.vehicleUse
 * businessMetrics.monthlyGwp
 * etc.
 */
export function getFieldValue(
  data: Record<string, any>,
  field: string
): unknown {

  return field
    .split(".")
    .reduce(
      (current: any, key: string) => {
        if (
          current === undefined ||
          current === null
        ) {
          return undefined;
        }

        return current[key];
      },
      data
    );
}


export function matchConditions(
  data: Record<string, any>,
  conditions: RuleCondition[]
): RuleMatchResult {

  const details = conditions.map(condition => {

    const actualValue = getFieldValue(
      data,
      condition.field
    );

    const matched = evaluateOperator(
      actualValue,
      condition.operator,
      condition.value
    );

    return {
      field: condition.field,
      operator: condition.operator,
      actualValue,
      expectedValue: condition.value,
      matched
    };
  });

  return {
    matched: details.every(
      detail => detail.matched
    ),

    details
  };
}