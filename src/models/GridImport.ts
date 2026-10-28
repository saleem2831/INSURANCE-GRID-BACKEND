import mongoose, { Schema } from "mongoose";

const GridImportSchema = new Schema(
  {
    insuranceCompanyId: {
      type: Schema.Types.ObjectId,
      ref: "InsuranceCompany",
      required: true,
      index: true
    },
    gridId: {
      type: Schema.Types.ObjectId,
      ref: "CommissionGrid",
      default: null,
      index: true
    },
    version: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },
    logicalKey: {
      type: String,
      required: true,
      default: "MOTOR_GRID",
      uppercase: true,
      trim: true,
      index: true
    },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    fileName: { type: String, required: true },
    fileHash: { type: String, required: true, index: true },
    fileSize: { type: Number, required: true },
    storagePath: { type: String, required: true },
    parser: { type: String, required: true },
    parserProfileId: { type: Schema.Types.ObjectId, ref: "GridParserProfile", default: null, index: true },
    status: {
      type: String,
      enum: ["UPLOADED", "NEEDS_PARSER", "PARSED", "VALIDATED", "IMPORTED", "FAILED", "REPLACED"],
      default: "UPLOADED",
      index: true
    },
    action: {
      type: String,
      enum: ["CREATE", "REPLACE", "DUPLICATE"],
      required: true
    },
    sheetNames: { type: [String], default: [] },
    rulesDetected: { type: Number, default: 0 },
    rtoMappingsDetected: { type: Number, default: 0 },
    rulesImported: { type: Number, default: 0 },
    rtoMappingsImported: { type: Number, default: 0 },
    warnings: { type: [String], default: [] },
    errors: { type: [String], default: [] },
    replacesImportId: {
      type: Schema.Types.ObjectId,
      ref: "GridImport",
      default: null
    }
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

GridImportSchema.index({ insuranceCompanyId: 1, version: 1, fileHash: 1 });
GridImportSchema.index({ insuranceCompanyId: 1, version: 1, logicalKey: 1, createdAt: -1 });
GridImportSchema.index({ fileHash: 1, createdAt: -1 });

export default mongoose.model("GridImport", GridImportSchema);
