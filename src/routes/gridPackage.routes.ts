import { Router } from "express";
import multer from "multer";
import {
  commitGridPackage,
  deleteGridPackage,
  getGridDocumentDownload,
  getGridPackage,
  listGridPackages,
  previewGridPackage,
  revalidateGridPackage,
  updateGridDocument
} from "../services/gridPackage.service";
import { GRID_DOCUMENT_ROLES } from "../models/GridDocument";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, callback) => {
    const n = file.originalname.toLowerCase();
    if (![".xlsx", ".xls", ".xlsb", ".pdf"].some(ext => n.endsWith(ext))) {
      callback(new Error("Only XLSX, XLS, XLSB and PDF package documents are allowed"));
      return;
    }
    callback(null, true);
  }
});

router.get("/roles", (_req, res) => {
  res.json({ success: true, data: GRID_DOCUMENT_ROLES });
});

router.get("/", async (req, res) => {
  try {
    const data = await listGridPackages({
      companyCode: req.query.companyCode as string | undefined,
      status: req.query.status as string | undefined,
      version: req.query.version as string | undefined
    });
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Unable to list grid packages" });
  }
});

router.post("/preview", upload.array("files", 50), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ success: false, message: "At least one package file is required" });
    const relativePaths: string[] = (() => {
      try { return JSON.parse(String(req.body.relativePaths || "[]")); } catch { return []; }
    })();
    const overrides = (() => {
      try { return JSON.parse(String(req.body.documentOverrides || "[]")); } catch { return []; }
    })();
    const data = await previewGridPackage({
      insuranceCompanyId: req.body.insuranceCompanyId || undefined,
      companyCode: req.body.companyCode || undefined,
      companyName: req.body.companyName || undefined,
      version: req.body.version,
      effectiveFrom: req.body.effectiveFrom,
      effectiveTo: req.body.effectiveTo || undefined,
      name: req.body.name || undefined,
      sourceType: req.body.sourceType || (files.length === 1 ? "SINGLE_FILE" : "COMPANY_FOLDER"),
      overrides,
      files: files.map((f, i) => ({
        originalname: f.originalname,
        size: f.size,
        buffer: f.buffer,
        relativePath: relativePaths[i] || f.originalname
      }))
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Package preview failed" });
  }
});

router.get("/:packageId", async (req, res) => {
  try { res.json({ success: true, data: await getGridPackage(String(req.params.packageId)) }); }
  catch (error) { res.status(404).json({ success: false, message: error instanceof Error ? error.message : "Grid package not found" }); }
});

router.patch("/:packageId/documents/:documentId", async (req, res) => {
  try {
    const data = await updateGridDocument(String(req.params.packageId), String(req.params.documentId), {
      role: req.body.role,
      productScope: req.body.productScope,
      required: req.body.required,
      parserProfileId: req.body.parserProfileId
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Unable to update document" });
  }
});

router.post("/:packageId/revalidate", async (req, res) => {
  try { res.json({ success: true, data: await revalidateGridPackage(String(req.params.packageId)) }); }
  catch (error) { res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Package validation failed" }); }
});

router.post("/:packageId/commit", async (req, res) => {
  try {
    const activate = String(req.body.activate ?? "true").toLowerCase() !== "false";
    res.json({ success: true, data: await commitGridPackage(String(req.params.packageId), activate) });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Package commit failed" });
  }
});

router.get("/:packageId/documents/:documentId/download", async (req, res) => {
  try {
    const doc = await getGridDocumentDownload(String(req.params.packageId), String(req.params.documentId));
    res.download(doc.storagePath, doc.fileName);
  } catch (error) {
    res.status(404).json({ success: false, message: error instanceof Error ? error.message : "Package document not found" });
  }
});

router.delete("/:packageId", async (req, res) => {
  try {
    const force = String(req.query.force ?? "false").toLowerCase() === "true";
    res.json({ success: true, data: await deleteGridPackage(String(req.params.packageId), force) });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      message: error instanceof Error ? error.message : "Package delete failed",
      requiresForce: Boolean(error?.requiresForce)
    });
  }
});

export default router;
