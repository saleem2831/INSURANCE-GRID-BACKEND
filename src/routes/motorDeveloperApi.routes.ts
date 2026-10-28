import { Router } from "express";
import { compareMotorRequest, getInputCatalog, getMotorFormConfig, validateMotorRequest } from "../services/motorDeveloperApi.service";

const router = Router();
router.get("/options", (_req, res) => res.json({success: true, data: getInputCatalog()}));
router.get("/form-config/:motorTypeId", (req, res) => {
  const config = getMotorFormConfig(Number(req.params.motorTypeId), Number(req.query.fuelTypeId));
  if (!config) return res.status(404).json({success: false, error: "MOTOR_TYPE_NOT_FOUND"});
  return res.json({success: true, data: config});
});
router.post("/validate", (req, res) => {
  const result = validateMotorRequest(req.body);
  return res.status(result.valid ? 200 : 422).json({success: result.valid, ...result});
});
router.post("/compare", async (req, res) => {
  try {
    const result = await compareMotorRequest(req.body);
    return res.status(result.status).json(result.body);
  } catch(error) {
    console.error("Developer API comparison failed:", error);
    return res.status(500).json({ success: false, error: "ENGINE_ERROR", message: "Unable to complete commission comparison. Check backend logs." });
  }
});
export default router;
