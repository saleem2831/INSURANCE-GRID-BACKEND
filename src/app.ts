import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import insuranceCompanyRoutes from "./routes/insuranceCompany.routes";
import commissionGridRoutes from "./routes/commissionGrid.routes";
import commissionRuleRoutes from "./routes/commissionRule.routes";
import ruleEngineRoutes from "./routes/ruleEngine.routes";
import commissionComparisonRoutes from "./routes/commissionComparison.routes";
import gridImportRoutes from "./routes/gridImport.routes";
import parserProfileRoutes from "./routes/parserProfile.routes";
import gridPackageRoutes from "./routes/gridPackage.routes";
import motorDeveloperApiRoutes from "./routes/motorDeveloperApi.routes";
import motorDocsRoutes from "./routes/motorDocs.routes";

const app = express();

const configuredOrigins = String(process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors(configuredOrigins.length ? {
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  }
} : undefined));
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "motor-commission-engine",
    status: "healthy"
  });
});

app.use("/api/insurance-companies", insuranceCompanyRoutes);
app.use("/api/commission-grids", commissionGridRoutes);
app.use("/api", commissionRuleRoutes);
app.use("/api/rule-engine", ruleEngineRoutes);
app.use("/api/commission", commissionComparisonRoutes);
app.use("/api/grid-import", gridImportRoutes);
app.use("/api/parser-profiles", parserProfileRoutes);
app.use("/api/grid-packages", gridPackageRoutes);
app.use("/api/v1/motor", motorDeveloperApiRoutes);
app.use("/api-docs", motorDocsRoutes);

// Serve the zero-dependency test frontend from the sibling frontend folder.
const frontendDir = path.resolve(
  process.env.FRONTEND_DIR || path.join(process.cwd(), "..", "frontend")
);

if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

export default app;
