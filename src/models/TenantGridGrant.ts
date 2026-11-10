import mongoose, { Schema } from "mongoose";

const TenantGridGrantSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  insuranceCompanyId: { type: Schema.Types.ObjectId, ref: "InsuranceCompany", required: true, index: true },
  packageId: { type: Schema.Types.ObjectId, ref: "GridPackage", required: true, index: true },
  enabled: { type: Boolean, default: true, index: true },
  notes: { type: String, default: "" }
}, { timestamps: true });
TenantGridGrantSchema.index({ tenantId: 1, packageId: 1 }, { unique: true });
TenantGridGrantSchema.index({ tenantId: 1, insuranceCompanyId: 1, enabled: 1 });
export default mongoose.model("TenantGridGrant", TenantGridGrantSchema);
