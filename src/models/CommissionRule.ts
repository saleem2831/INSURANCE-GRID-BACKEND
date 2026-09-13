import mongoose, { Schema } from "mongoose";

const RuleConditionSchema = new Schema(
  {
    field: {
      type: String,
      required: true
    },

    operator: {
      type: String,
      enum: [
        "EQUAL",
        "NOT_EQUAL",
        "IN",
        "NOT_IN",
        "BETWEEN",
        "GT",
        "GTE",
        "LT",
        "LTE",
        "EXISTS"
      ],
      required: true
    },

    value: {
      type: Schema.Types.Mixed
    }
  },
  {
    _id: false
  }
);

const CommissionRuleSchema = new Schema(
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

    packageId: {
      type: Schema.Types.ObjectId,
      ref: "GridPackage",
      default: null,
      index: true
    },

    documentId: {
      type: Schema.Types.ObjectId,
      ref: "GridDocument",
      default: null,
      index: true
    },

    ruleCode: {
      type: String,
      required: true
    },

    product: {
      type: String,
      required: true,
      index: true
    },

    priority: {
      type: Number,
      default: 100
    },

    ruleKind: {
      type: String,
      enum: ["DERIVATION", "BASE", "ADJUSTMENT", "OVERRIDE", "EXCLUSION"],
      default: "BASE",
      index: true
    },

    ruleGroup: { type: String, default: null, index: true },

    conditions: {
      type: [RuleConditionSchema],
      default: []
    },

    result: {
      type: {
        type: String,
        enum: [
          "PAYOUT",
          "DECLINE",
          "NO_BUSINESS",
          "IRDA",
          "COUNCIL_CALL",
          "MANUAL_REVIEW",
          "DERIVE"
        ],
        required: true
      },

      percentage: Number,

      basis: {
        type: String,
        enum: [
          "OD",
          "TP",
          "NET",
          "GROSS",
          "GWP",
          "OD_TP",
          "FIXED",
          null
        ],
        default: null
      },

      fixedAmount: Number,
      reason: String,
      setField: String,
      value: Schema.Types.Mixed,
      components: {
        type: [{
          basis: { type: String, enum: ["OD","TP","NET","GROSS","GWP","OD_TP","FIXED"], required: true },
          percentage: { type: Number, required: true }
        }],
        default: []
      }
    },

    source: {
      fileName: String,
      sheet: String,
      row: Number,
      column: String,
      originalText: String
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

CommissionRuleSchema.index(
  {
    gridId: 1,
    ruleCode: 1
  },
  {
    unique: true
  }
);

CommissionRuleSchema.index({
  gridId: 1,
  product: 1,
  active: 1,
  priority: -1
});

export default mongoose.model(
  "CommissionRule",
  CommissionRuleSchema
);