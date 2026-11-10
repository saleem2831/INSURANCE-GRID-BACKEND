import mongoose, { Schema } from "mongoose";

const TenantSchema = new Schema({
  code: { type: String, required: true, unique: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true, index: true },
  // A random 256-bit bearer credential is hashed before storage; never store plain keys.
  apiKeyHash: { type: String, required: true, unique: true, select: false },
  notes: { type: String, default: "" }
}, { timestamps: true });
export default mongoose.model("Tenant", TenantSchema);
