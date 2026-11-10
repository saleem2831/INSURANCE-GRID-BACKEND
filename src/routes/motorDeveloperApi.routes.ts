import { Router } from "express";
import {type TenantRequest} from "../services/tenantAccess.service";
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
    const auth=(req as TenantRequest).tenantAuth;
    const result = await compareMotorRequest(req.body,auth);
    return res.status(result.status).json(result.body);
  } catch(error: any) {
    const status = Number(error?.statusCode);
    const httpStatus = Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
    if (httpStatus === 500) console.error("Developer API comparison failed:", error);
    return res.status(httpStatus).json({
      success: false,
      error: httpStatus === 403 ? "FORBIDDEN" : httpStatus === 400 ? "VALIDATION_FAILED" : "ENGINE_ERROR",
      message: httpStatus === 500 ? "Unable to complete commission comparison. Check backend logs." : String(error?.message || "Request rejected"),
      ...(httpStatus === 400 && error?.details ? { details: error.details } : {})
    });
  }
});
export default router;
