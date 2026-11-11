/** Calendar-day policy-date and package precedence policy. Does not mutate historical packages. */
export const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "Asia/Kolkata";

export function businessDateKey(now = new Date(), timeZone = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (name: string) => parts.find(p => p.type === name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isCalendarDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function resolveQuoteDate(value?: unknown, now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  if (value !== undefined && value !== null && typeof value !== "string") throw Object.assign(new Error("Policy date must be YYYY-MM-DD."), { statusCode: 400 });
  const wasDefaulted = !value;
  const key = wasDefaulted ? businessDateKey(now, timeZone) : String(value);
  if (!isCalendarDateKey(key)) throw Object.assign(new Error("Invalid policy date. Use YYYY-MM-DD."), { statusCode: 400 });
  return { key, date: new Date(`${key}T00:00:00.000Z`), wasDefaulted, timeZone };
}

export interface SelectablePackage {
  _id?: unknown; insuranceCompanyId?: unknown; ownerTenantId?: unknown;
  effectiveFrom: Date | string; effectiveTo?: Date | string | null;
  createdAt?: Date | string; status: string; gridId?: unknown; productCoverage?: string[];
}

/**
 * Validated/committed versions keep their historical rows. A newer effective-from date
 * supersedes an older one for the requested day, but never deletes or changes the old rules.
 * Shared and private scopes remain distinct; a tenant-owned package takes precedence if
 * that same tenant has explicitly been granted it.
 */
export function choosePackageForDate<T extends SelectablePackage>(packages: T[], date: Date, tenantId?: string, product?: string): T | null {
  const eligible = packages.filter(p =>
    (p.status === "ACTIVE" || p.status === "EXPIRED") && p.gridId &&
    (!product || (p.productCoverage || []).includes(product)) &&
    new Date(p.effectiveFrom).getTime() <= date.getTime() &&
    (!p.effectiveTo || new Date(p.effectiveTo).getTime() >= date.getTime()) &&
    (!p.ownerTenantId || (tenantId && String(p.ownerTenantId) === tenantId))
  );
  eligible.sort((a, b) => {
    if (tenantId) {
      const privateA = String(a.ownerTenantId || "") === tenantId ? 1 : 0;
      const privateB = String(b.ownerTenantId || "") === tenantId ? 1 : 0;
      if (privateA !== privateB) return privateB - privateA;
    }
    const dateDelta = new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
    if (dateDelta !== 0) return dateDelta;
    const stateDelta = Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE");
    if (stateDelta !== 0) return stateDelta;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  return eligible[0] ?? null;
}

export function gridReviewState(effectiveFrom: Date | string, now = new Date(), thresholdDays = Number(process.env.GRID_REVIEW_DAYS || 30), timeZone = BUSINESS_TIME_ZONE) {
  const key = businessDateKey(now, timeZone);
  const days = Math.floor((Date.parse(`${key}T00:00:00.000Z`) - new Date(effectiveFrom).getTime()) / 86400000);
  return { daysSinceEffective: Math.max(0, days), reviewDue: days >= thresholdDays, thresholdDays, advisoryOnly: true };
}
