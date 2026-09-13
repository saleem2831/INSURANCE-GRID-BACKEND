import "dotenv/config";

import app from "./app";
import { connectDatabase } from "./config/database";
import { syncInsurerCatalog } from "./services/insurerCatalog.service";

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  try {
    await connectDatabase();
    await syncInsurerCatalog();
    console.log("Insurer catalog synchronized from src/config/insurers.json");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Motor Commission Engine running on 0.0.0.0:${PORT}`
      );
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

start();