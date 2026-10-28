import { Router } from "express";
import { getMotorOpenApiSpec } from "../docs/motorOpenApi";
const router = Router();
router.get("/openapi.json", (req,res) => {
  const host = req.get("host") ?? "localhost:4000";
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return res.json(getMotorOpenApiSpec(`${proto}://${host}`));
});
router.get("/", (_req,res) => res.type("html").send(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Motor Commission — Swagger API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/><style>body{margin:0;background:#f4f7fb}.fallback{margin:12px 24px;font:14px system-ui}</style></head><body><p class="fallback">Developer API · <a href="/api-docs/openapi.json">Download OpenAPI JSON</a>. Swagger UI requires internet access to load its client assets.</p><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>if(window.SwaggerUIBundle)window.SwaggerUIBundle({url:'/api-docs/openapi.json',dom_id:'#swagger-ui',deepLinking:true,displayRequestDuration:true,defaultModelsExpandDepth:1});</script></body></html>`));
export default router;
