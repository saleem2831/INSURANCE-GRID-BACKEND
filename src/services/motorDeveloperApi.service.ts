/** Developer-facing adapter for legacy V7 deterministic insurer comparison. */
import motorMaster from "../config/motorInputMaster.json";

type CatalogItem = { id: number; code: string; label: string };
type MotorItem = CatalogItem & { product: string; capacityDimension: string; vehicleAgeRequired: boolean };
type PolicyItem = CatalogItem & { enginePolicyType: string; nilDep?: boolean };
type FuelItem = CatalogItem & { engineFuelType: string };
type CapacityItem = CatalogItem & { dimension: string; min: number | null; max: number | null; includeMin: boolean; includeMax: boolean };

const policies = motorMaster.policyTypes as PolicyItem[];
const motors = motorMaster.motorTypes as MotorItem[];
const fuels = motorMaster.fuelTypes as FuelItem[];
const capacities = motorMaster.capacities as CapacityItem[];

export type ApiError = { field: string; code: string; message: string };
export type ApiWarning = ApiError;
export interface MotorInputRequest {
  policy_type_id?: number;
  motor_type_id?: number;
  fuel_type_id?: number;
  capacity_id?: number | null;
  capacity_value?: number | null;
  rto?: string;
  vehicle_make?: string;
  vehicle_age?: number | null;
  policy_date?: string;
  ncb?: number | null;
  model?: string;
  vehicle_use?: string;
  seating_capacity?: number;
  school_ownership?: boolean;
  premium?: Record<string, unknown>;
  business_metrics?: Record<string, unknown>;
  additional_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

const selectById = <T extends CatalogItem>(rows: T[], id: unknown) =>
  Number.isSafeInteger(id) ? rows.find(x => x.id === id) : undefined;

const clean = (value: unknown) => String(value ?? "").trim();
const isNonneg = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function matchesCapacity(c: CapacityItem, amount: number): boolean {
  return (c.min === null || (c.includeMin ? amount >= c.min : amount > c.min)) &&
    (c.max === null || (c.includeMax ? amount <= c.max : amount < c.max));
}

export function getInputCatalog() {
  return { version: motorMaster.version, policyTypes: policies, motorTypes: motors, fuelTypes: fuels, capacities };
}

export function getMotorFormConfig(motorId: unknown, fuelId?: unknown) {
  const motor = selectById(motors, motorId);
  if (!motor) return null;
  const fuel = selectById(fuels, fuelId);
  const dimension = (motor.product === "TWO_WHEELER" || motor.product === "PRIVATE_CAR") && fuel?.code === "ELECTRIC" ? "WATT" : motor.capacityDimension;
  return {
    motor,
    capacityDimension: dimension,
    capacityRequired: dimension !== "NONE",
    vehicleAgeRequired: motor.vehicleAgeRequired,
    fields: [
      { field: "policy_type_id", required: true },
      { field: "motor_type_id", required: true },
      { field: "fuel_type_id", required: true },
      { field: "rto", required: true },
      { field: "vehicle_make", required: true },
      { field: "vehicle_age", required: motor.vehicleAgeRequired },
      { field: "capacity_value", required: dimension !== "NONE", dimension },
      { field: "capacity_id", required: false, dimension }
    ],
    capacityOptions: capacities.filter(c => c.dimension === dimension),
    note: "A raw numeric capacity is required where applicable. The labels overlap and are hints only; exact payout bands remain insurer-specific."
  };
}

/** Never guesses a payout, an insurer RTO cluster, or a vehicle age. */
export function validateMotorRequest(raw: unknown) {
  const errors: ApiError[] = [];
  const warnings: ApiWarning[] = [];
  const error = (field: string, code: string, message: string) => errors.push({ field, code, message });
  const warning = (field: string, code: string, message: string) => warnings.push({ field, code, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    error("body", "INVALID_REQUEST", "Expected a JSON object.");
    return { valid: false, errors, warnings, normalized: null, engineInput: null };
  }
  const input = raw as MotorInputRequest;
  const policy = selectById(policies, input.policy_type_id);
  const motor = selectById(motors, input.motor_type_id);
  const fuel = selectById(fuels, input.fuel_type_id);
  if (!policy) error("policy_type_id", "INVALID_POLICY_TYPE", "Select a policy type from GET /api/v1/motor/options.");
  if (!motor) error("motor_type_id", "INVALID_MOTOR_TYPE", "Select a motor type from GET /api/v1/motor/options.");
  if (!fuel) error("fuel_type_id", "INVALID_FUEL_TYPE", "Select a fuel type from GET /api/v1/motor/options.");

  const rto = clean(input.rto).toUpperCase().replace(/\s+/g, "");
  if (!rto) error("rto", "REQUIRED", "RTO is required.");
  else if (!/^[A-Z]{2}-?\d{1,2}[A-Z]?$/i.test(rto)) error("rto", "INVALID_RTO", "Use an RTO such as MH-01, AP-21, or DL-01.");
  const make = clean(input.vehicle_make).toUpperCase();
  if (!make) error("vehicle_make", "REQUIRED", "Vehicle make is required.");
  if (make.length > 120) error("vehicle_make", "TOO_LONG", "Vehicle make is too long.");
  if (motor?.product === "UNKNOWN") error("motor_type_id", "CHOOSE_SPECIFIC_MOTOR_TYPE", "The generic Commercial type is ambiguous. Select a concrete type such as LCV, HCV, Taxi or Bus.");
  const age = input.vehicle_age;
  if (motor?.vehicleAgeRequired && (age === undefined || age === null || age === "" as any))
    error("vehicle_age", "REQUIRED_FOR_MOTOR_TYPE", `Vehicle age is required for ${motor.label}.`);
  if (age !== undefined && age !== null && (!Number.isInteger(age) || age < 0 || age > 100))
    error("vehicle_age", "INVALID_AGE", "Vehicle age must be an integer between 0 and 100.");

  const policyDate = input.policy_date === undefined || input.policy_date === null || input.policy_date === "" ? undefined : clean(input.policy_date);
  if (policyDate && (!/^\d{4}-\d{2}-\d{2}$/.test(policyDate) || Number.isNaN(Date.parse(policyDate)) || new Date(`${policyDate}T00:00:00Z`).toISOString().slice(0,10) !== policyDate))
    error("policy_date", "INVALID_DATE", "Policy date must be a valid YYYY-MM-DD date.");
  if (!policyDate) error("policy_date", "REQUIRED", "A policy date is required to select the correct effective insurer grids.");

  if (input.ncb !== undefined && input.ncb !== null && (!isNonneg(input.ncb) || input.ncb > 100))
    error("ncb", "INVALID_NCB", "NCB must be a percentage from 0 to 100.");
  const dimension = (motor?.product === "TWO_WHEELER" || motor?.product === "PRIVATE_CAR") && fuel?.code === "ELECTRIC" ? "WATT" : motor?.capacityDimension ?? "NONE";
  const numericCapacity = input.capacity_value;
  if (dimension !== "NONE") {
    if (numericCapacity === undefined || numericCapacity === null || !isNonneg(numericCapacity) || numericCapacity === 0)
      error("capacity_value", "CAPACITY_VALUE_REQUIRED", `Enter the actual numeric capacity in ${dimension === "GVW" ? "kg" : dimension === "SEATS" ? "seats" : dimension === "WATT" ? "watts" : "cc"}; overlapping labels are insufficient for accurate matching.`);
    else if (dimension === "SEATS" && !Number.isInteger(numericCapacity)) error("capacity_value", "INVALID_SEATS", "Seating capacity must be an integer.");
  } else if (numericCapacity !== undefined && numericCapacity !== null && !isNonneg(numericCapacity)) error("capacity_value", "INVALID_CAPACITY", "Capacity must be a non-negative number.");

  let cap: CapacityItem | undefined;
  if (input.capacity_id !== undefined && input.capacity_id !== null) {
    cap = selectById(capacities, input.capacity_id);
    if (!cap) error("capacity_id", "INVALID_CAPACITY_ID", "Unknown capacity ID.");
    else if (cap.dimension !== dimension) error("capacity_id", "INCOMPATIBLE_CAPACITY", `Selected motor/fuel requires ${dimension}, not ${cap.dimension}.`);
    else if (typeof numericCapacity === "number" && !matchesCapacity(cap, numericCapacity)) error("capacity_id", "CAPACITY_MISMATCH", "Actual capacity falls outside the selected capacity label. Choose a matching label or clear capacity_id.");
  }
  if (dimension !== "NONE" && typeof numericCapacity === "number" && isNonneg(numericCapacity)) {
    const bands = capacities.filter(c => c.dimension === dimension && matchesCapacity(c, numericCapacity));
    if (bands.length > 1) warning("capacity_id", "OVERLAPPING_CAPACITY_BANDS", `The numeric capacity matches ${bands.length} display labels. The engine will use the actual ${dimension} value and insurer-specific boundaries.`);
    if (bands.length === 0) warning("capacity_id", "NO_DISPLAY_BAND", "No predefined display band covers this numeric value; source rules can still evaluate the raw value.");
  }
  if (policy && motor) {
    if ((policy.code === "BUNDLED_1_5" || policy.code === "BUNDLED_5_5") && motor.product !== "TWO_WHEELER") warning("policy_type_id", "UNUSUAL_POLICY_COMBINATION", "This term is commonly used for two-wheelers; exact support depends on the insurer grid.");
    if ((policy.code === "BUNDLED_1_3" || policy.code === "BUNDLED_3_3") && motor.product === "TWO_WHEELER") warning("policy_type_id", "UNUSUAL_POLICY_COMBINATION", "Verify this bundled term against the insurer's two-wheeler source grid.");
    if (policy.code === "BUNDLED_5_5") warning("policy_type_id", "SOURCE_COVERAGE_REQUIRED", "5+5 may be unsupported in existing importer rules. No substitute policy will be used.");
  }
  if (motor?.code === "PRIVATE_WITHOUT_GEAR_BIKE") warning("motor_type_id", "AMBIGUOUS_LABEL", "The supplied master says 'Private without Gear (Bike)'. Confirm with the business team whether this is really Bike or Scooter.");
  const [rtoRegion, rtoNumeric] = [rto.slice(0,2), rto.slice(2).replace("-", "")];
  const normalizedRto = /^[A-Z]{2}$/.test(rtoRegion) && /^\d{1,2}$/.test(rtoNumeric) ? `${rtoRegion}-${rtoNumeric.padStart(2,"0")}` : rto;

  if (errors.length || !motor || !fuel || !policy) return { valid: false, errors, warnings, normalized: null, engineInput: null };
  const normalized = {
    policy_type_id: policy.id, motor_type_id: motor.id, fuel_type_id: fuel.id,
    capacity_id: cap?.id ?? null, capacity_value: numericCapacity ?? null,
    rto: normalizedRto, vehicle_make: make, vehicle_age: age ?? null,
    policy_date: policyDate, policy_type: policy.code, motor_type: motor.code,
    fuel_type: fuel.code, product: motor.product, capacity_dimension: dimension
  };
  const engineInput: Record<string, unknown> = {
    product: motor.product,
    policyDate,
    policyType: policy.enginePolicyType,
    fuelType: fuel.engineFuelType,
    make,
    rtoCode: normalizedRto,
    ...(age !== undefined && age !== null ? {vehicleAge: age} : {}),
    ...(input.ncb !== undefined && input.ncb !== null ? {ncb: input.ncb} : {}),
    ...(input.model ? {model: String(input.model).trim().toUpperCase()} : {}),
    ...(input.premium ? {premium: input.premium} : {}),
    ...(input.business_metrics ? {businessMetrics: input.business_metrics} : {})
  };
  // Map only validated canonical engine fields, never make up a missing insurer-specific input.
  const allowedAdditional = new Set(["odDiscountPercent", "addOnCover", "cpaTaken", "nilDep", "vehicleType", "businessType", "carrierType", "ownershipType", "vehicleCategory", "vehicleSegment", "schoolOwnership", "evKw", "cc", "gvw", "seatingCapacity", "model", "odPercentage", "makeGroup"]);
  if (input.additional_fields && typeof input.additional_fields === "object" && !Array.isArray(input.additional_fields)) {
    for (const [key, value] of Object.entries(input.additional_fields)) {
      if (allowedAdditional.has(key)) engineInput[key] = value;
      else warning("additional_fields", "FIELD_NOT_ALLOWED", `Additional field ${key} was ignored; only approved insurer-specific input fields are accepted.`);
    }
  }
  if (policy.nilDep === true) engineInput.nilDep = true;
  else if (policy.code === "COMPREHENSIVE_NON_ZD") engineInput.nilDep = false;
  if (motor.product === "TWO_WHEELER") {
    if (motor.code.includes("SCOOTER")) engineInput.vehicleType = "SCOOTER";
    else if (motor.code.includes("WITH_GEAR_BIKE")) engineInput.vehicleType = "MOTOR_CYCLE";
    // Generic TWO_WHEELER and contradictory labels are left unset; the source rule can request vehicleType.
  }
  if (motor.code.startsWith("TAXI_") || motor.code === "PCCV_CAR") { engineInput.vehicleUse = "TAXI"; engineInput.vehicleType = "TAXI"; engineInput.vehicleCategory = "TAXI"; }
  if (motor.code === "SCHOOL_BUS") { engineInput.vehicleUse = "SCHOOL"; engineInput.vehicleType = "BUS"; engineInput.vehicleCategory = "BUS"; }
  if (motor.code === "SCHOOL_VAN") { engineInput.vehicleUse = "SCHOOL"; engineInput.vehicleType = "VAN"; engineInput.vehicleCategory = "VAN"; }
  if (motor.code === "STAFF_BUS") { engineInput.vehicleUse = "STAFF"; engineInput.vehicleType = "BUS"; engineInput.vehicleCategory = "BUS"; }
  if (motor.code === "BUS" || motor.code === "CONTRACT_CARRIAGE_BUS" || motor.code === "TOURIST_BUS") { engineInput.vehicleType = "BUS"; engineInput.vehicleCategory = "BUS"; }
  if (motor.code === "TOURIST_BUS") engineInput.vehicleUse = "TOURIST_BUS";
  if (motor.code === "THREE_WHEELER_GOODS" || motor.code.startsWith("THREE_WHEELER_")) {engineInput.vehicleType="3W";engineInput.vehicleCategory="3W";}
  if (motor.code === "TRUCK") engineInput.vehicleType = "TRUCK";
  if (motor.code === "TRACTOR") engineInput.vehicleType = "TRACTOR";
  if (motor.code === "MISC_D") engineInput.vehicleType = "MISC_D";
  if (input.vehicle_use) engineInput.vehicleUse = String(input.vehicle_use).toUpperCase();
  if (input.school_ownership !== undefined) engineInput.schoolOwnership = input.school_ownership;
  if (input.seating_capacity !== undefined) engineInput.seatingCapacity = input.seating_capacity;
  if (dimension === "CC" && typeof numericCapacity === "number") engineInput.cc = numericCapacity;
  if (dimension === "GVW" && typeof numericCapacity === "number") engineInput.gvw = numericCapacity;
  if (dimension === "SEATS" && typeof numericCapacity === "number") engineInput.seatingCapacity = numericCapacity;
  if (dimension === "WATT" && typeof numericCapacity === "number") engineInput.evKw = numericCapacity / 1000;
  return { valid: true, errors, warnings, normalized, engineInput };
}

export async function compareMotorRequest(input: unknown) {
  const validated = validateMotorRequest(input);
  if (!validated.valid || !validated.engineInput) return { status: 422 as const, body: { success: false, error: "VALIDATION_FAILED", ...validated } };
  const { compareCommissions } = await import("./commissionComparison.service");
  const comparison = await compareCommissions(validated.engineInput as any);
  return { status: 200 as const, body: { success: true, data: comparison, normalized: validated.normalized, warnings: validated.warnings } };
}
