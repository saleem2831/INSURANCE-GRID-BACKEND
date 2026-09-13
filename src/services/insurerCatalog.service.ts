import InsuranceCompany from "../models/InsuranceCompany";
import { INSURERS } from "../config/insurers";

/** Ensure the database always contains every company declared in insurers.json. */
export async function syncInsurerCatalog() {
  await Promise.all(INSURERS.map(def => InsuranceCompany.findOneAndUpdate(
    { code: def.code },
    {
      $set: { name: def.name },
      $setOnInsert: { code: def.code, active: true }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  )));
}

export async function getCatalogWithDatabaseState() {
  const rows = await InsuranceCompany.find({ code: { $in: INSURERS.map(x => x.code) } }).lean();
  const byCode = new Map(rows.map((r: any) => [String(r.code), r]));
  return INSURERS.map((def, order) => {
    const row: any = byCode.get(def.code);
    return {
      ...(row || {}),
      _id: row?._id ?? null,
      code: def.code,
      name: def.name,
      aliases: def.aliases,
      active: row?.active !== false,
      catalogOrder: order
    };
  });
}
