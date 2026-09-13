import { Router } from "express";
import multer from "multer";
import { readExcelBuffer } from "../imports/excelReader";
import { builtInParserCapabilities } from "../imports/parserRegistry";
import {
  commitGridImport,
  deleteGridImport,
  getGridImport,
  getGridImportDownload,
  listGridImports,
  previewGridImport
} from "../services/gridImport.service";

const router = Router();

router.get("/capabilities", (_req, res) => {
  res.json({
    success: true,
    data: {
      builtIn: builtInParserCapabilities(),
      genericProfiles: { layout: "ROW_TABLE", supported: true },
      accuracyPolicy: "Unknown/complex workbook structures are never guessed. They remain PARSER_REQUIRED/MANUAL_REVIEW until configured."
    }
  });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const lower = file.originalname.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      callback(new Error("Only Excel files are allowed"));
      return;
    }
    callback(null, true);
  }
});

router.get("/files", async (req, res) => {
  try {
    const rows = await listGridImports({
      companyCode: req.query.companyCode as string | undefined,
      status: req.query.status as string | undefined,
      version: req.query.version as string | undefined
    });
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Unable to list uploads" });
  }
});

router.get("/:importId", async (req, res) => {
  try {
    return res.json({ success: true, data: await getGridImport(String(req.params.importId)) });
  } catch (error) {
    return res.status(404).json({ success: false, message: error instanceof Error ? error.message : "Grid import not found" });
  }
});

router.get("/:importId/download", async (req, res) => {
  try {
    const row = await getGridImportDownload(String(req.params.importId));
    return res.download(row.storagePath, row.fileName);
  } catch (error) {
    return res.status(404).json({ success: false, message: error instanceof Error ? error.message : "Stored file not found" });
  }
});

router.delete("/files/:importId", async (req, res) => {
  try {
    const force = String(req.query.force ?? "false").toLowerCase() === "true";
    return res.json({ success: true, data: await deleteGridImport(String(req.params.importId), force) });
  } catch (error: any) {
    const status = error?.statusCode || 400;
    return res.status(status).json({
      success: false,
      message: error instanceof Error ? error.message : "Delete failed",
      requiresForce: Boolean(error?.requiresForce)
    });
  }
});

router.post("/inspect", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Excel file is required" });
    const sheets = readExcelBuffer(req.file.buffer);
    return res.json({
      success: true,
      file: { name: req.file.originalname, size: req.file.size },
      sheets: sheets.map(sheet => ({
        name: sheet.name,
        rowCount: sheet.rows.length,
        preview: sheet.rows.slice(0, 20)
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Unable to inspect Excel file" });
  }
});

router.post("/preview", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Excel file is required" });
    const { insuranceCompanyId, companyCode, companyName, version, effectiveFrom, effectiveTo, gridScope, parserProfileId } = req.body;
    if (!insuranceCompanyId && !companyCode) {
      return res.status(400).json({ success: false, message: "insuranceCompanyId or companyCode is required" });
    }
    if (!version) return res.status(400).json({ success: false, message: "version is required" });
    if (!effectiveFrom) return res.status(400).json({ success: false, message: "effectiveFrom is required" });

    const preview = await previewGridImport({
      insuranceCompanyId: insuranceCompanyId || undefined,
      companyCode: companyCode || undefined,
      companyName: companyName || undefined,
      version,
      effectiveFrom,
      effectiveTo: effectiveTo || undefined,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      buffer: req.file.buffer,
      gridScope: gridScope || undefined,
      parserProfileId: parserProfileId || undefined
    });
    return res.json({ success: true, data: preview });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Grid preview failed" });
  }
});

// File is optional now. Preview persists it, so the frontend can commit by importId only.
// A supplied file is still accepted for backward compatibility and hash-checked.
router.post("/:importId/commit", upload.single("file"), async (req, res) => {
  try {
    const result = await commitGridImport({
      importId: String(req.params.importId),
      buffer: req.file?.buffer,
      fileName: req.file?.originalname,
      activate: String(req.body.activate ?? "true").toLowerCase() !== "false"
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Grid commit failed" });
  }
});

export default router;
