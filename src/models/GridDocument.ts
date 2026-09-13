import mongoose, { Schema } from "mongoose";

export const GRID_DOCUMENT_ROLES = [
  "PAYOUT_GRID",
  "PRODUCT_GRID",
  "RTO_MASTER",
  "CLUSTER_MASTER",
  "INCREMENTAL_GRID",
  "EXCLUSION_GRID",
  "GUIDELINES",
  "LOOKUP_MASTER",
  "REFERENCE_DOCUMENT"
] as const;

const GridDocumentSchema = new Schema(
  {
    packageId: { type: Schema.Types.ObjectId, ref: "GridPackage", required: true, index: true },
    insuranceCompanyId: { type: Schema.Types.ObjectId, ref: "InsuranceCompany", required: true, index: true },
    fileName: { type: String, required: true },
    relativePath: { type: String, default: null },
    fileHash: { type: String, required: true, index: true },
    fileSize: { type: Number, required: true },
    storagePath: { type: String, required: true },
    fileType: { type: String, required: true, uppercase: true },
    role: { type: String, enum: GRID_DOCUMENT_ROLES, required: true, index: true },
    productScope: { type: [String], default: [] },
    required: { type: Boolean, default: true },
    parser: { type: String, default: null },
    parserProfileId: { type: Schema.Types.ObjectId, ref: "GridParserProfile", default: null, index: true },
    status: {
      type: String,
      enum: ["STORED", "VALIDATED", "REVIEW_REQUIRED", "FAILED", "IMPORTED"],
      default: "STORED",
      index: true
    },
    sheetNames: { type: [String], default: [] },
    rulesDetected: { type: Number, default: 0 },
    rtoMappingsDetected: { type: Number, default: 0 },
    warnings: { type: [String], default: [] },
    errors: { type: [String], default: [] },
    preview: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

GridDocumentSchema.index({ packageId: 1, fileHash: 1 });
GridDocumentSchema.index({ packageId: 1, role: 1 });

export default mongoose.model("GridDocument", GridDocumentSchema);
