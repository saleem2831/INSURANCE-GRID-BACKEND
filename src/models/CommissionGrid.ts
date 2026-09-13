import mongoose, { Schema } from "mongoose";

const CommissionGridSchema = new Schema(
  {
    insuranceCompanyId: {
      type: Schema.Types.ObjectId,
      ref: "InsuranceCompany",
      required: true,
      index: true
    },

    packageId: {
      type: Schema.Types.ObjectId,
      ref: "GridPackage",
      default: null,
      index: true
    },

    name: {
      type: String,
      required: true
    },

    version: {
      type: String,
      required: true
    },

    // One insurer/version may legitimately be supplied in multiple workbooks
    // (for example Tata AIG CV/TW + Private Car TP). logicalKey keeps those
    // source documents independently versioned instead of replacing each other.
    logicalKey: {
      type: String,
      required: true,
      default: "MOTOR_GRID",
      uppercase: true,
      trim: true,
      index: true
    },

    effectiveFrom: {
      type: Date,
      required: true
    },

    effectiveTo: {
      type: Date,
      default: null
    },

    status: {
      type: String,
      enum: [
        "DRAFT",
        "PARSED",
        "VALIDATED",
        "APPROVED",
        "ACTIVE",
        "EXPIRED"
      ],
      default: "DRAFT",
      index: true
    },

    source: {
      fileName: String,
      fileUrl: String,
      sheetNames: [String]
    },

    notes: String
  },
  {
    timestamps: true
  }
);

CommissionGridSchema.index({
  insuranceCompanyId: 1,
  status: 1,
  effectiveFrom: -1
});
CommissionGridSchema.index({ insuranceCompanyId: 1, version: 1, logicalKey: 1, createdAt: -1 });
CommissionGridSchema.index({ packageId: 1, status: 1 });

export default mongoose.model(
  "CommissionGrid",
  CommissionGridSchema
);