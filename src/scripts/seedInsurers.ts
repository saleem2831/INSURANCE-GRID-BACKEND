import "dotenv/config";
import { connectDatabase } from "../config/database";
import InsuranceCompany from "../models/InsuranceCompany";
import { INSURERS } from "../config/insurers";

async function main() {
  await connectDatabase();
  for (const insurer of INSURERS) {
    await InsuranceCompany.findOneAndUpdate(
      { code: insurer.code },
      { code: insurer.code, name: insurer.name, shortName: insurer.name, active: true },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    console.log(`Seeded ${insurer.code}`);
  }
  console.log(`Seeded ${INSURERS.length} canonical insurers.`);
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
