export type ProductCode = "PRIVATE_CAR" | "PCV" | "GCV" | "TWO_WHEELER";

export interface FieldRequirement { field: string; label: string; }
export interface ComparisonFieldDefinition extends FieldRequirement {
  type: "text" | "number" | "select" | "boolean" | "date";
  placeholder?: string;
  options?: Array<{ value: string | number | boolean; label: string }>;
}

// Exact minimum payout-dependent fields from Required Details.xlsx supplied by the user.
export const PRODUCT_REQUIRED_FIELDS: Record<ProductCode, FieldRequirement[]> = {
  PRIVATE_CAR: [
    { field: "policyType", label: "Product Type" },
    { field: "ncb", label: "NCB Status / %" },
    { field: "fuelType", label: "Fuel Type" },
    { field: "rtoCode", label: "RTO" },
    { field: "make", label: "Vehicle Make" }
  ],
  PCV: [
    { field: "vehicleUse", label: "Use of vehicle" },
    { field: "seatingCapacity", label: "Seating capacity" },
    { field: "ownershipType", label: "Ownership type" },
    { field: "vehicleAge", label: "Vehicle Age" },
    { field: "fuelType", label: "Fuel Type" },
    { field: "ncb", label: "NCB Status / %" },
    { field: "policyType", label: "Product Type" },
    { field: "rtoCode", label: "RTO" },
    { field: "make", label: "Vehicle Make" },
    { field: "vehicleType", label: "Vehicle Type" }
  ],
  GCV: [
    { field: "gvw", label: "GVW" },
    { field: "rtoCode", label: "RTO" },
    { field: "make", label: "Vehicle Make" },
    { field: "vehicleAge", label: "Vehicle Age" },
    { field: "policyType", label: "Product Type" },
    { field: "ncb", label: "NCB Status / %" }
  ],
  TWO_WHEELER: [
    { field: "policyType", label: "Product Type" },
    { field: "ncb", label: "NCB Status / %" },
    { field: "fuelType", label: "Fuel Type" },
    { field: "rtoCode", label: "RTO" },
    { field: "cc", label: "Cubic Capacity" },
    { field: "make", label: "Vehicle Make" }
  ]
};

export const COMPARISON_FIELD_CATALOG: Record<string, ComparisonFieldDefinition> = {
  policyDate: { field: "policyDate", label: "Policy / Grid Date", type: "date" },
  policyType: { field: "policyType", label: "Product / Cover Type", type: "select", options: [
    { value: "COMP", label: "Comprehensive / Package" }, { value: "COMP_1_1", label: "Comprehensive 1+1" },
    { value: "COMP_1_3", label: "Comprehensive 1+3" }, { value: "COMP_1_5", label: "Comprehensive 1+5" },
    { value: "COMP_3_3", label: "Comprehensive 3+3" }, { value: "SAOD", label: "SAOD" },
    { value: "SATP", label: "Third Party / SATP" }, { value: "AOTP", label: "AOTP" }, { value: "LIABILITY", label: "Liability" }
  ]},
  ncb: { field: "ncb", label: "NCB %", type: "number", placeholder: "0" },
  fuelType: { field: "fuelType", label: "Fuel Type", type: "select", options: [
    { value: "PETROL", label: "Petrol" }, { value: "DIESEL", label: "Diesel" }, { value: "CNG", label: "CNG" },
    { value: "ELECTRIC", label: "Electric" }, { value: "LPG", label: "LPG" }
  ]},
  rtoCode: { field: "rtoCode", label: "RTO", type: "text", placeholder: "AP-21" },
  make: { field: "make", label: "Vehicle Make", type: "text", placeholder: "TATA" },
  model: { field: "model", label: "Vehicle Model", type: "text" },
  vehicleAge: { field: "vehicleAge", label: "Vehicle Age (years)", type: "number" },
  gvw: { field: "gvw", label: "GVW (kg)", type: "number" },
  cc: { field: "cc", label: "Cubic Capacity (CC)", type: "number" },
  vehicleUse: { field: "vehicleUse", label: "Use of Vehicle", type: "select", options: [
    { value: "SCHOOL", label: "School Bus" }, { value: "STAFF", label: "Staff Bus" }, { value: "TAXI", label: "Taxi" },
    { value: "ROUTE_BUS", label: "Route Bus" }, { value: "TOURIST_BUS", label: "Tourist Bus" }, { value: "OTHER", label: "Other" }
  ]},
  seatingCapacity: { field: "seatingCapacity", label: "Seating Capacity", type: "number" },
  ownershipType: { field: "ownershipType", label: "Ownership Type", type: "select", options: [
    { value: "INDIVIDUAL", label: "Individual" }, { value: "CORPORATE", label: "Corporate" }, { value: "SCHOOL", label: "School / Institution" }
  ]},
  vehicleType: { field: "vehicleType", label: "Vehicle Type", type: "select", options: [
    { value: "4W", label: "4 Wheeler" }, { value: "3W", label: "3 Wheeler" }, { value: "BUS", label: "Bus" },
    { value: "MOTOR_CYCLE", label: "Motor Cycle" }, { value: "SCOOTER", label: "Scooter" }, { value: "MOPED", label: "Moped" },
    { value: "TANKER", label: "Tanker" }, { value: "TIPPER", label: "Tipper" }, { value: "TRUCK", label: "Truck" },
    { value: "TRAILER", label: "Trailer" }, { value: "TRACTOR", label: "Tractor" }, { value: "MISC_D", label: "Misc-D" }
  ]},
  businessType: { field: "businessType", label: "Business Type", type: "select", options: [
    { value: "NEW", label: "New" }, { value: "BRAND NEW", label: "Brand New" }, { value: "RENEWAL", label: "Renewal" }, { value: "ROLLOVER", label: "Rollover" }
  ]},
  vehicleCategory: { field: "vehicleCategory", label: "Vehicle Category", type: "text" },
  vehicleSegment: { field: "vehicleSegment", label: "Vehicle Segment", type: "text" },
  carrierType: { field: "carrierType", label: "Carrier Type", type: "text" },
  geoCluster: { field: "geoCluster", label: "Insurer Geo Segment", type: "text" },
  rtoCluster: { field: "rtoCluster", label: "RTO Cluster", type: "text" },
  rtoSubCluster: { field: "rtoSubCluster", label: "RTO Sub Cluster", type: "text" },
  rtoRegion: { field: "rtoRegion", label: "RTO Region / Location", type: "text" },
  "businessMetrics.monthlyGwp": { field: "businessMetrics.monthlyGwp", label: "Monthly GWP / Volume", type: "number" },
  "businessMetrics.nop": { field: "businessMetrics.nop", label: "NOP", type: "number" },
  odDiscountPercent: { field: "odDiscountPercent", label: "OD Discount %", type: "number" },
  cpaTaken: { field: "cpaTaken", label: "CPA Taken?", type: "boolean", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }] },
  addOnCover: { field: "addOnCover", label: "Add-on Cover?", type: "boolean", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }] },
  nilDep: { field: "nilDep", label: "Nil Dep / Zero Dep?", type: "boolean", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }] },
  evKw: { field: "evKw", label: "EV kW", type: "number" },
  schoolOwnership: { field: "schoolOwnership", label: "Registered in school/institution name?", type: "boolean", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }] },
  "premium.gwp": { field: "premium.gwp", label: "Policy GWP (optional, for commission amount)", type: "number" }
};

export function getComparisonInputSchema(product: string) {
  const code = String(product || "").toUpperCase() as ProductCode;
  const required = PRODUCT_REQUIRED_FIELDS[code] ?? [];
  return {
    product: code,
    context: [COMPARISON_FIELD_CATALOG.policyDate],
    required: required.map(r => COMPARISON_FIELD_CATALOG[r.field] ?? { ...r, type: "text" as const }),
    note: "Only base payout-dependent fields are requested up front. Insurer-specific fields are returned dynamically as NEEDS_INPUT when a source rule actually requires them."
  };
}

function hasValue(value: unknown): boolean { return value !== undefined && value !== null && value !== ""; }
function readPath(input: Record<string, any>, path: string) {
  return path.split(".").reduce<any>((cur, part) => cur?.[part], input);
}

export function validateRequiredComparisonFields(product: string, input: Record<string, any>) {
  const requirements = PRODUCT_REQUIRED_FIELDS[product as ProductCode] ?? [];
  const missing = requirements.filter(req => !hasValue(readPath(input, req.field)));
  return { valid: missing.length === 0, required: requirements, missing };
}
