import rawInsurers from "./insurers.json";

export interface InsurerDefinition {
  code: string;
  name: string;
  aliases: string[];
}

/**
 * Single source of truth for every insurer shown by the application.
 * Add a new company to insurers.json; no frontend hard-coding is required.
 */
export const INSURERS: InsurerDefinition[] = (rawInsurers as InsurerDefinition[]).map(x => ({
  code: String(x.code).trim().toUpperCase(),
  name: String(x.name).trim(),
  aliases: Array.isArray(x.aliases) ? x.aliases.map(a => String(a).trim().toUpperCase()) : []
}));

export const INSURER_CODES = INSURERS.map(x => x.code);

const aliasMap = new Map<string, string>();
for (const insurer of INSURERS) {
  aliasMap.set(insurer.code, insurer.code);
  for (const alias of insurer.aliases) aliasMap.set(alias, insurer.code);
}

export function canonicalCompanyCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return aliasMap.get(code) || code;
}

export function insurerByCode(value: unknown): InsurerDefinition | undefined {
  const code = canonicalCompanyCode(value);
  return INSURERS.find(x => x.code === code);
}
