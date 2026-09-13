import mongoose, { Schema } from "mongoose";

const GridIRSchema = new Schema({
  packageId: { type: Schema.Types.ObjectId, ref: "GridPackage", required: true, index: true },
  documentId: { type: Schema.Types.ObjectId, ref: "GridDocument", required: true, unique: true, index: true },
  insuranceCompanyId: { type: Schema.Types.ObjectId, ref: "InsuranceCompany", required: true, index: true },
  sourceType: { type: String, enum: ["EXCEL","PDF","XLSB","OTHER"], required: true },
  extractor: { type: String, default: null },
  textAvailable: { type: Boolean, default: false },
  ocrUsed: { type: Boolean, default: false },
  pageCount: { type: Number, default: 0 },
  pages: { type: [Schema.Types.Mixed], default: [] },
  sheets: { type: [Schema.Types.Mixed], default: [] },
  layoutHints: { type: Schema.Types.Mixed, default: {} },
  metadata: { type: Schema.Types.Mixed, default: {} },
  warnings: { type: [String], default: [] }
}, { timestamps: true });

export default mongoose.model("GridIR", GridIRSchema);
