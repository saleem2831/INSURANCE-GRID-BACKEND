import { RuleOperator } from "./types";

function normalizeString(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  return null;
}

export function evaluateOperator(
  actualValue: unknown,
  operator: RuleOperator,
  expectedValue?: unknown
): boolean {

  // Accuracy safeguard: an absent field must never satisfy NOT_EQUAL/NOT_IN.
  // Otherwise a missing vehicle category, make, etc. can accidentally match a
  // broad exclusion rule. EXISTS is the only operator that intentionally
  // evaluates absence.
  const absent = actualValue === undefined || actualValue === null || actualValue === "";
  if (operator !== "EXISTS" && absent) return false;

  switch (operator) {

    case "EQUAL": {
      return (
        normalizeString(actualValue) ===
        normalizeString(expectedValue)
      );
    }

    case "NOT_EQUAL": {
      return (
        normalizeString(actualValue) !==
        normalizeString(expectedValue)
      );
    }

    case "IN": {
      if (!Array.isArray(expectedValue)) {
        return false;
      }

      const actual = normalizeString(actualValue);

      return expectedValue.some(
        value =>
          normalizeString(value) === actual
      );
    }

    case "NOT_IN": {
      if (!Array.isArray(expectedValue)) {
        return false;
      }

      const actual = normalizeString(actualValue);

      return !expectedValue.some(
        value =>
          normalizeString(value) === actual
      );
    }

    case "BETWEEN": {
      if (
        !Array.isArray(expectedValue) ||
        expectedValue.length !== 2
      ) {
        return false;
      }

      const actual = toNumber(actualValue);
      const minimum = toNumber(expectedValue[0]);
      const maximum = toNumber(expectedValue[1]);

      if (
        actual === null ||
        minimum === null ||
        maximum === null
      ) {
        return false;
      }

      return (
        actual >= minimum &&
        actual <= maximum
      );
    }

    case "GT": {
      const actual = toNumber(actualValue);
      const expected = toNumber(expectedValue);

      if (
        actual === null ||
        expected === null
      ) {
        return false;
      }

      return actual > expected;
    }

    case "GTE": {
      const actual = toNumber(actualValue);
      const expected = toNumber(expectedValue);

      if (
        actual === null ||
        expected === null
      ) {
        return false;
      }

      return actual >= expected;
    }

    case "LT": {
      const actual = toNumber(actualValue);
      const expected = toNumber(expectedValue);

      if (
        actual === null ||
        expected === null
      ) {
        return false;
      }

      return actual < expected;
    }

    case "LTE": {
      const actual = toNumber(actualValue);
      const expected = toNumber(expectedValue);

      if (
        actual === null ||
        expected === null
      ) {
        return false;
      }

      return actual <= expected;
    }

    case "EXISTS": {
      const exists =
        actualValue !== undefined &&
        actualValue !== null &&
        actualValue !== "";

      if (expectedValue === false) {
        return !exists;
      }

      return exists;
    }

    default:
      return false;
  }
}