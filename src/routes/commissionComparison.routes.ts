import { Router } from "express";
import { compareCommissions } from "../services/commissionComparison.service";
import { PRODUCT_REQUIRED_FIELDS, getComparisonInputSchema } from "../services/comparisonInputValidation";

const router = Router();

router.get("/requirements", (_req, res) => res.json({ success: true, data: PRODUCT_REQUIRED_FIELDS }));
router.get("/input-schema/:product", (req, res) => {
  const schema = getComparisonInputSchema(String(req.params.product));
  if (!schema.required.length) return res.status(400).json({ success: false, message: "Unsupported product" });
  res.json({ success: true, data: schema });
});

router.post("/compare", async (req, res) => {
  try {
    if (!req.body.product) return res.status(400).json({ success: false, message: "product is required" });
    const comparison = await compareCommissions(req.body);
    return res.json({ success: true, data: comparison });
  } catch (error: any) {
    console.error("Commission comparison error:", error);
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error instanceof Error ? error.message : "Commission comparison failed",
      details: error?.details ?? undefined
    });
  }
});

export default router;
