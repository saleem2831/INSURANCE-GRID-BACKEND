import { Router } from "express";
import mongoose from "mongoose";
import GridParserProfile from "../models/GridParserProfile";
import InsuranceCompany from "../models/InsuranceCompany";

const router = Router();

async function resolveCompany(body: any) {
  if (body.insuranceCompanyId && mongoose.Types.ObjectId.isValid(body.insuranceCompanyId)) {
    const c = await InsuranceCompany.findById(body.insuranceCompanyId);
    if (!c) throw new Error("Insurance company not found");
    return c;
  }
  const code = String(body.companyCode || "").trim().toUpperCase();
  const name = String(body.companyName || "").trim();
  if (!code) throw new Error("insuranceCompanyId or companyCode is required");
  let c = await InsuranceCompany.findOne({ code });
  if (!c) {
    if (!name) throw new Error("companyName is required when creating a new company");
    c = await InsuranceCompany.create({ code, name, shortName: name, active: true });
  }
  return c;
}

router.get("/", async (req, res) => {
  try {
    const filter: any = {};
    if (req.query.companyCode) {
      const c = await InsuranceCompany.findOne({ code: String(req.query.companyCode).toUpperCase() }).lean();
      if (!c) return res.json({ success: true, count: 0, data: [] });
      filter.insuranceCompanyId = c._id;
    }
    const rows = await GridParserProfile.find(filter)
      .populate("insuranceCompanyId", "code name active")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Unable to list parser profiles" });
  }
});

router.post("/", async (req, res) => {
  try {
    const company = await resolveCompany(req.body);
    const { name, sheetName, headerRow, product, result, conditions, notes, active } = req.body;
    if (!name || !sheetName || !product?.mode || !result?.column) {
      return res.status(400).json({ success: false, message: "name, sheetName, product.mode and result.column are required" });
    }
    const row = await GridParserProfile.findOneAndUpdate(
      { insuranceCompanyId: company._id, name: String(name).trim() },
      {
        insuranceCompanyId: company._id,
        name: String(name).trim(),
        active: active !== false,
        layout: "ROW_TABLE",
        sheetName: String(sheetName).trim(),
        headerRow: Number(headerRow || 1),
        product,
        result,
        conditions: Array.isArray(conditions) ? conditions : [],
        notes
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).lean();
    res.status(201).json({ success: true, data: row });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Unable to save parser profile" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid profile id" });
    const row = await GridParserProfile.findByIdAndDelete(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Parser profile not found" });
    res.json({ success: true, data: { deleted: true, id: row._id } });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Delete failed" });
  }
});

export default router;
