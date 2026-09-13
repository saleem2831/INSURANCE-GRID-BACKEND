import { Router } from "express";
import mongoose from "mongoose";

import CommissionRule from "../models/CommissionRule";
import CommissionGrid from "../models/CommissionGrid";

const router = Router();

const ALLOWED_OPERATORS = [
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
];

const ALLOWED_RESULT_TYPES = [
  "PAYOUT",
  "DECLINE",
  "NO_BUSINESS",
  "IRDA",
  "COUNCIL_CALL",
  "MANUAL_REVIEW"
];


/**
 * CREATE RULE FOR A GRID
 *
 * POST /api/commission-grids/:gridId/rules
 */
router.post(
  "/commission-grids/:gridId/rules",
  async (req, res) => {
    try {
      const { gridId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(gridId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid grid ID"
        });
      }

      const grid = await CommissionGrid.findById(gridId);

      if (!grid) {
        return res.status(404).json({
          success: false,
          message: "Commission grid not found"
        });
      }

      const {
        ruleCode,
        product,
        priority,
        conditions,
        result,
        source
      } = req.body;

      if (!ruleCode || !product) {
        return res.status(400).json({
          success: false,
          message: "ruleCode and product are required"
        });
      }

      if (!Array.isArray(conditions)) {
        return res.status(400).json({
          success: false,
          message: "conditions must be an array"
        });
      }

      for (const condition of conditions) {
        if (!condition.field || !condition.operator) {
          return res.status(400).json({
            success: false,
            message:
              "Every condition requires field and operator"
          });
        }

        if (
          !ALLOWED_OPERATORS.includes(
            String(condition.operator)
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              `Unsupported operator: ${condition.operator}`
          });
        }

        if (
          condition.operator === "BETWEEN" &&
          (
            !Array.isArray(condition.value) ||
            condition.value.length !== 2
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              `BETWEEN requires [minimum, maximum] for ${condition.field}`
          });
        }

        if (
          ["IN", "NOT_IN"].includes(condition.operator) &&
          !Array.isArray(condition.value)
        ) {
          return res.status(400).json({
            success: false,
            message:
              `${condition.operator} requires an array`
          });
        }
      }

      if (!result?.type) {
        return res.status(400).json({
          success: false,
          message: "result.type is required"
        });
      }

      if (!ALLOWED_RESULT_TYPES.includes(result.type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid result type"
        });
      }

      if (
        result.type === "PAYOUT" &&
        typeof result.percentage !== "number"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "PAYOUT rule requires result.percentage"
        });
      }

      const existing = await CommissionRule.findOne({
        gridId,
        ruleCode: String(ruleCode).trim().toUpperCase()
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            "Rule code already exists in this grid"
        });
      }

      const rule = await CommissionRule.create({
        insuranceCompanyId: grid.insuranceCompanyId,

        gridId,

        ruleCode: String(ruleCode)
          .trim()
          .toUpperCase(),

        product: String(product)
          .trim()
          .toUpperCase(),

        priority:
          typeof priority === "number"
            ? priority
            : 100,

        conditions,

        result,

        source,

        active: true
      });

      return res.status(201).json({
        success: true,
        data: rule
      });

    } catch (error) {
      console.error("Create commission rule error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to create commission rule"
      });
    }
  }
);


/**
 * GET RULES FOR A GRID
 *
 * GET /api/commission-grids/:gridId/rules
 */
router.get(
  "/commission-grids/:gridId/rules",
  async (req, res) => {
    try {
      const { gridId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(gridId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid grid ID"
        });
      }

      const rules = await CommissionRule.find({
        gridId
      })
        .sort({
          priority: -1,
          ruleCode: 1
        })
        .lean();

      return res.json({
        success: true,
        count: rules.length,
        data: rules
      });

    } catch (error) {
      console.error("Get rules error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch rules"
      });
    }
  }
);


/**
 * GET ONE RULE
 */
router.get(
  "/commission-rules/:id",
  async (req, res) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(req.params.id)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid rule ID"
        });
      }

      const rule = await CommissionRule.findById(
        req.params.id
      ).lean();

      if (!rule) {
        return res.status(404).json({
          success: false,
          message: "Commission rule not found"
        });
      }

      return res.json({
        success: true,
        data: rule
      });

    } catch (error) {
      console.error("Get rule error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch rule"
      });
    }
  }
);

export default router;