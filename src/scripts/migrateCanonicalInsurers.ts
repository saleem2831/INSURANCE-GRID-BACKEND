import "dotenv/config";
import { connectDatabase } from "../config/database";
import InsuranceCompany from "../models/InsuranceCompany";
import CommissionGrid from "../models/CommissionGrid";
import CommissionRule from "../models/CommissionRule";
import RtoMapping from "../models/RtoMapping";
import GridImport from "../models/GridImport";
import GridPackage from "../models/GridPackage";
import GridDocument from "../models/GridDocument";
import GridParserProfile from "../models/GridParserProfile";
import GridIR from "../models/GridIR";
import { INSURERS, canonicalCompanyCode } from "../config/insurers";

async function repoint(fromId: any, toId: any) {
  const models: any[] = [CommissionGrid, CommissionRule, RtoMapping, GridImport, GridPackage, GridDocument, GridIR];
  for (const model of models) await model.updateMany({ insuranceCompanyId: fromId }, { insuranceCompanyId: toId });

  const profiles: any[] = await GridParserProfile.find({ insuranceCompanyId: fromId });
  for (const profile of profiles) {
    const duplicate = await GridParserProfile.findOne({ insuranceCompanyId: toId, name: profile.name });
    if (duplicate) await GridParserProfile.deleteOne({ _id: profile._id });
    else await GridParserProfile.updateOne({ _id: profile._id }, { insuranceCompanyId: toId });
  }
}

async function main() {
  await connectDatabase();
  const existing: any[] = await InsuranceCompany.find();

  for (const row of existing) {
    const canonical = canonicalCompanyCode(row.code);
    const def = INSURERS.find(x => x.code === canonical);
    if (!def || row.code === canonical) continue;

    let target: any = await InsuranceCompany.findOne({ code: canonical });
    if (!target) {
      row.code = canonical;
      row.name = def.name;
      row.shortName = row.shortName || def.name;
      row.active = true;
      await row.save();
      console.log(`Renamed ${row._id} -> ${canonical}`);
      continue;
    }

    await repoint(row._id, target._id);
    await InsuranceCompany.deleteOne({ _id: row._id });
    console.log(`Merged ${row.code} into ${canonical}`);
  }

  for (const def of INSURERS) {
    await InsuranceCompany.findOneAndUpdate(
      { code: def.code },
      { code: def.code, name: def.name, shortName: def.name, active: true },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  }
  console.log(`Canonical insurer migration complete. Master contains ${INSURERS.length} target insurers.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
