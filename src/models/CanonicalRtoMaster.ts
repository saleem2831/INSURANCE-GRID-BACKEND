import mongoose, { Schema } from "mongoose";

const CanonicalRtoMasterSchema = new Schema({
  rtoCode: { type: String, required: true, unique: true, uppercase: true, index: true },
  normalizedCode: { type: String, required: true, uppercase: true, index: true },
  stateCode: { type: String, required: true, uppercase: true, index: true },
  stateName: { type: String, required: true, uppercase: true, index: true },
  city: { type: String, default: null },
  region: { type: String, default: null },
  active: { type: Boolean, default: true }
}, { timestamps: true });

CanonicalRtoMasterSchema.index({ stateCode: 1, active: 1 });
export default mongoose.model("CanonicalRtoMaster", CanonicalRtoMasterSchema);
