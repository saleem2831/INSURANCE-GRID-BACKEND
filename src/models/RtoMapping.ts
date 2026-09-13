import mongoose, { Schema } from "mongoose";

const RtoMappingSchema = new Schema(
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
      required: true,
      index: true
    },
    packageId: { type: Schema.Types.ObjectId, ref: "GridPackage", default: null, index: true },
    documentId: { type: Schema.Types.ObjectId, ref: "GridDocument", default: null, index: true },
    rtoCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true
    },
    originalRtoCode: String,
    product: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true
    },
    cluster: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    region: String,
    state: String,
    location: String,
    subCluster: String,
    actuarialCluster: String,
    mappingClass: String,
    metadata: Schema.Types.Mixed,
    source: {
      fileName: String,
      sheet: String,
      row: Number
    }
  },
  { timestamps: true }
);

RtoMappingSchema.index({
  gridId: 1,
  rtoCode: 1,
  product: 1
});

export default mongoose.model("RtoMapping", RtoMappingSchema);
