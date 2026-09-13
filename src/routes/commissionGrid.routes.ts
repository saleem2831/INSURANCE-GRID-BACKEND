import { Router } from "express";
import mongoose from "mongoose";

import CommissionGrid from "../models/CommissionGrid";
import InsuranceCompany from "../models/InsuranceCompany";

const router = Router();

/**
 * CREATE A COMMISSION GRID
 */
router.post("/", async (req, res) => {
  try {
    const {
      insuranceCompanyId,
      name,
      version,
      effectiveFrom,
      effectiveTo,
      status,
      source,
      notes
    } = req.body;

    if (
      !insuranceCompanyId ||
      !name ||
      !version ||
      !effectiveFrom
    ) {
      return res.status(400).json({
        success: false,
        message:
          "insuranceCompanyId, name, version and effectiveFrom are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(insuranceCompanyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid insuranceCompanyId"
      });
    }

    const company = await InsuranceCompany.findById(
      insuranceCompanyId
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Insurance company not found"
      });
    }

    const existingGrid = await CommissionGrid.findOne({
      insuranceCompanyId,
      version
    });

    if (existingGrid) {
      return res.status(409).json({
        success: false,
        message:
          "This grid version already exists for the insurance company"
      });
    }

    const fromDate = new Date(effectiveFrom);

    if (Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid effectiveFrom date"
      });
    }

    let toDate: Date | undefined;

    if (effectiveTo) {
      toDate = new Date(effectiveTo);

      if (Number.isNaN(toDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid effectiveTo date"
        });
      }

      if (toDate < fromDate) {
        return res.status(400).json({
          success: false,
          message:
            "effectiveTo cannot be before effectiveFrom"
        });
      }
    }

    const grid = await CommissionGrid.create({
      insuranceCompanyId,

      name: String(name).trim(),

      version: String(version)
        .trim()
        .toUpperCase(),

      effectiveFrom: fromDate,

      effectiveTo: toDate,

      status: status || "DRAFT",

      source,

      notes
    });

    const populatedGrid = await CommissionGrid.findById(
      grid._id
    ).populate(
      "insuranceCompanyId",
      "code name shortName"
    );

    return res.status(201).json({
      success: true,
      data: populatedGrid
    });

  } catch (error) {
    console.error("Create grid error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create commission grid"
    });
  }
});


/**
 * GET ALL GRIDS
 */
router.get("/", async (req, res) => {
  try {
    const {
      insuranceCompanyId,
      status
    } = req.query;

    const filter: Record<string, unknown> = {};

    if (insuranceCompanyId) {
      filter.insuranceCompanyId =
        insuranceCompanyId;
    }

    if (status) {
      filter.status = status;
    }

    const grids = await CommissionGrid.find(filter)
      .populate(
        "insuranceCompanyId",
        "code name shortName"
      )
      .sort({
        effectiveFrom: -1
      })
      .lean();

    return res.json({
      success: true,
      count: grids.length,
      data: grids
    });

  } catch (error) {
    console.error("Get grids error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch commission grids"
    });
  }
});


/**
 * GET ONE GRID
 */
router.get("/:id", async (req, res) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid grid ID"
      });
    }

    const grid = await CommissionGrid.findById(
      req.params.id
    )
      .populate(
        "insuranceCompanyId",
        "code name shortName"
      )
      .lean();

    if (!grid) {
      return res.status(404).json({
        success: false,
        message: "Commission grid not found"
      });
    }

    return res.json({
      success: true,
      data: grid
    });

  } catch (error) {
    console.error("Get grid error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch commission grid"
    });
  }
});

export default router;