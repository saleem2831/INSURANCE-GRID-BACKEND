import mongoose, { Schema } from "mongoose";

const ConditionProfileSchema = new Schema(
  {
    field: { type: String, required: true, trim: true },
    column: { type: String, required: true, trim: true },
    operator: {
      type: String,
      enum: ["EQUAL", "IN", "BETWEEN", "GTE", "GT", "LTE", "LT", "EXISTS", "RANGE"],
      default: "EQUAL"
    },
    parser: {
      type: String,
      enum: ["TEXT", "NUMBER", "BOOLEAN", "POLICY_TYPE", "AGE_RANGE", "GVW_RANGE", "MONEY_SLAB", "NOP_SLAB"],
      default: "TEXT"
    },
    skipIfEmpty: { type: Boolean, default: true }
  },
  { _id: false }
);

const GridParserProfileSchema = new Schema(
  {
    insuranceCompanyId: {
      type: Schema.Types.ObjectId,
      ref: "InsuranceCompany",
      required: true,
      index: true
    },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true, index: true },
    layout: { type: String, enum: ["ROW_TABLE", "MATRIX", "MULTI_MATRIX", "STATE_MATRIX", "COLOR_MATRIX", "PDF_TABLE", "PDF_MATRIX"], default: "ROW_TABLE" },
    sheetName: { type: String, required: true, trim: true },
    headerRow: { type: Number, default: 1, min: 1 },
    product: {
      mode: { type: String, enum: ["CONSTANT", "COLUMN"], required: true },
      value: String,
      column: String
    },
    result: {
      column: { type: String, required: true },
      basis: {
        type: String,
        enum: ["OD", "TP", "NET", "GROSS", "GWP", "OD_TP", "FIXED"],
        default: "GWP"
      },
      priority: { type: Number, default: 100 },
      ruleKind: { type: String, enum: ["DERIVATION", "BASE", "ADJUSTMENT", "OVERRIDE", "EXCLUSION"], default: "BASE" }
    },
    conditions: { type: [ConditionProfileSchema], default: [] },
    notes: String
  },
  { timestamps: true }
);

GridParserProfileSchema.index({ insuranceCompanyId: 1, name: 1 }, { unique: true });
GridParserProfileSchema.index({ insuranceCompanyId: 1, active: 1, updatedAt: -1 });

export default mongoose.model("GridParserProfile", GridParserProfileSchema);
