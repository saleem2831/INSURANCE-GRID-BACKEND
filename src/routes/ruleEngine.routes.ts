import { Router } from "express";
import mongoose from "mongoose";

import CommissionRule from "../models/CommissionRule";

import {
  matchConditions
} from "../engine/matcher";

const router = Router();


router.post(
  "/test/:gridId",
  async (req, res) => {

    try {

      const { gridId } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(gridId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid grid ID"
        });
      }


      const policy = req.body;


      if (!policy.product) {
        return res.status(400).json({
          success: false,
          message: "product is required"
        });
      }


      /*
       * First reduce MongoDB candidates.
       *
       * We don't want to load completely
       * unrelated rules.
       */

      const rules = await CommissionRule.find({
        gridId,

        product: String(policy.product)
          .trim()
          .toUpperCase(),

        active: true
      })
        .sort({
          priority: -1
        })
        .lean();


      if (rules.length === 0) {
        return res.json({
          success: true,

          matched: false,

          message:
            "No rules found for this product",

          rulesChecked: 0
        });
      }


      const evaluations = rules.map(rule => {

        const match = matchConditions(
          policy,
          rule.conditions as any
        );

        return {
          ruleId: rule._id,

          ruleCode: rule.ruleCode,

          priority: rule.priority,

          matched: match.matched,

          details: match.details,

          result: rule.result
        };
      });


      /*
       * Rules were already sorted by
       * priority DESC.
       *
       * Therefore first match wins.
       */

      const winningRule =
        evaluations.find(
          evaluation =>
            evaluation.matched
        );


      if (!winningRule) {

        return res.json({
          success: true,

          matched: false,

          rulesChecked:
            evaluations.length,

          message:
            "No commission rule matched",

          evaluations
        });
      }


      return res.json({
        success: true,

        matched: true,

        rulesChecked:
          evaluations.length,

        matchedRule:
          winningRule,

        /*
         * Keep evaluations during development.
         *
         * This is extremely useful for debugging
         * insurer grids.
         */
        evaluations
      });


    } catch (error) {

      console.error(
        "Rule engine test error:",
        error
      );


      return res.status(500).json({
        success: false,

        message:
          "Rule engine evaluation failed"
      });

    }
  }
);


export default router;