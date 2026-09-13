import mongoose, { Schema } from "mongoose";

const GridPackageSchema = new Schema(
  {
    insuranceCompanyId: {
      type: Schema.Types.ObjectId,
      ref: "InsuranceCompany",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true },
    packageHash: { type: String, required: true, index: true },
    action: { type: String, enum: ["CREATE", "REPLACE", "DUPLICATE"], default: "CREATE" },
    replacesPackageId: { type: Schema.Types.ObjectId, ref: "GridPackage", default: null },
    version: { type: String, required: true, trim: true, uppercase: true, index: true },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["DRAFT", "VALIDATING", "VALIDATED", "ACTIVE", "EXPIRED", "FAILED"],
      default: "DRAFT",
      index: true
    },
    sourceType: {
      type: String,
      enum: ["SINGLE_FILE", "MULTI_FILE", "COMPANY_FOLDER"],
      default: "MULTI_FILE"
    },
    gridId: { type: Schema.Types.ObjectId, ref: "CommissionGrid", default: null, index: true },
    totalDocuments: { type: Number, default: 0 },
    totalRules: { type: Number, default: 0 },
    totalRtoMappings: { type: Number, default: 0 },
    productCoverage: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    errors: { type: [String], default: [] },
    validationSummary: { type: Schema.Types.Mixed, default: {} },
    notes: String
  },
  { timestamps: true }
);

GridPackageSchema.index({ insuranceCompanyId: 1, version: 1, createdAt: -1 });
GridPackageSchema.index({ insuranceCompanyId: 1, version: 1, packageHash: 1 });
GridPackageSchema.index({ insuranceCompanyId: 1, status: 1, effectiveFrom: -1 });

export default mongoose.model("GridPackage", GridPackageSchema);
