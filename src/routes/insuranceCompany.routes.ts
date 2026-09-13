import { Router } from "express";
import InsuranceCompany from "../models/InsuranceCompany";
import { canonicalCompanyCode, INSURERS } from "../config/insurers";
import { getCatalogWithDatabaseState, syncInsurerCatalog } from "../services/insurerCatalog.service";

const router = Router();

/** CREATE CUSTOM/NEW INSURANCE COMPANY. Prefer adding permanent companies to insurers.json. */
router.post("/", async (req, res) => {
  try {
    const { code, name, shortName } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: "code and name are required" });
    const normalizedCode = canonicalCompanyCode(code);
    const existing = await InsuranceCompany.findOne({ code: normalizedCode });
    if (existing) return res.status(409).json({ success: false, message: "Insurance company already exists" });
    const company = await InsuranceCompany.create({ code: normalizedCode, name: String(name).trim(), shortName: shortName ? String(shortName).trim() : undefined });
    return res.status(201).json({ success: true, data: company });
  } catch (error) {
    console.error("Create insurance company error:", error);
    return res.status(500).json({ success: false, message: "Unable to create insurance company" });
  }
});

/**
 * Returns the canonical JSON catalog, merged with Mongo state. This endpoint is
 * intentionally stable even before a grid has been uploaded for a company.
 */
router.get("/", async (_req, res) => {
  try {
    await syncInsurerCatalog();
    const companies = await getCatalogWithDatabaseState();
    return res.json({ success: true, source: "src/config/insurers.json", count: companies.length, data: companies });
  } catch (error) {
    console.error("Get companies error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch insurance companies" });
  }
});

router.get("/catalog", async (_req, res) => {
  res.json({ success: true, source: "src/config/insurers.json", count: INSURERS.length, data: INSURERS });
});

router.get("/:id", async (req, res) => {
  try {
    const company = await InsuranceCompany.findById(req.params.id).lean();
    if (!company) return res.status(404).json({ success: false, message: "Insurance company not found" });
    return res.json({ success: true, data: company });
  } catch {
    return res.status(400).json({ success: false, message: "Invalid insurance company ID" });
  }
});

export default router;
