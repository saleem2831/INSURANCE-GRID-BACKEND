import mongoose, { Schema } from "mongoose";

const InsuranceCompanySchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    shortName: {
      type: String,
      trim: true
    },

    active: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model(
  "InsuranceCompany",
  InsuranceCompanySchema
);