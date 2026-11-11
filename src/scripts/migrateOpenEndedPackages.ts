/** Convert old bounded company packages to the new open-ended model.
 * Dry-run by default. Back up Atlas before --apply.
 * The original Effective To is retained in previousEffectiveTo for audit.
 */
import "dotenv/config";
import mongoose from "mongoose";
import GridPackage from "../models/GridPackage";
import CommissionGrid from "../models/CommissionGrid";

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI missing");
  await mongoose.connect(uri);
  try {
    const packages: any[] = await GridPackage.find({ effectiveTo: { $ne: null } }).lean();
    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${packages.length} company packages have an old Effective To date.`);
    for (const p of packages) {
      console.log(`${p._id}: company ${p.insuranceCompanyId}, ${p.version}, old end ${p.effectiveTo?.toISOString?.()}, status ${p.status}`);
      if (!apply) continue;
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const updated = await GridPackage.updateOne(
            { _id: p._id, effectiveTo: p.effectiveTo },
            { $set: { effectiveTo: null, previousEffectiveTo: p.previousEffectiveTo || p.effectiveTo } },
            { session }
          );
          if (updated.modifiedCount !== 1) throw new Error(`Concurrent change detected on package ${p._id}`);
          if (p.gridId) await CommissionGrid.updateOne(
            { _id: p.gridId },
            { $set: { effectiveTo: null, previousEffectiveTo: p.effectiveTo } },
            { session }
          );
        });
      } finally { await session.endSession(); }
    }
    console.log(apply ? "Completed. Newer approved Effective From dates now govern supersession." : "No data changed. Re-run with --apply after backing up Atlas and reviewing the old expiry terms.");
  } finally { await mongoose.disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
