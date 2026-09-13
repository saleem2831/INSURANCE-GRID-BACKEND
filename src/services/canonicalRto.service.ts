export const RTO_PREFIX_STATE: Record<string, { stateCode: string; stateName: string }> = {
  AN:{stateCode:"AN",stateName:"ANDAMAN & NICOBAR"}, AP:{stateCode:"AP",stateName:"ANDHRA PRADESH"}, AR:{stateCode:"AR",stateName:"ARUNACHAL PRADESH"},
  AS:{stateCode:"AS",stateName:"ASSAM"}, BR:{stateCode:"BR",stateName:"BIHAR"}, CG:{stateCode:"CG",stateName:"CHHATTISGARH"}, CH:{stateCode:"CH",stateName:"CHANDIGARH"},
  DD:{stateCode:"DD",stateName:"DADRA & NAGAR HAVELI AND DAMAN & DIU"}, DL:{stateCode:"DL",stateName:"DELHI"}, DN:{stateCode:"DN",stateName:"DADRA & NAGAR HAVELI AND DAMAN & DIU"},
  GA:{stateCode:"GA",stateName:"GOA"}, GJ:{stateCode:"GJ",stateName:"GUJARAT"}, HP:{stateCode:"HP",stateName:"HIMACHAL PRADESH"}, HR:{stateCode:"HR",stateName:"HARYANA"},
  JH:{stateCode:"JH",stateName:"JHARKHAND"}, JK:{stateCode:"JK",stateName:"JAMMU & KASHMIR"}, KA:{stateCode:"KA",stateName:"KARNATAKA"}, KL:{stateCode:"KL",stateName:"KERALA"},
  LA:{stateCode:"LA",stateName:"LADAKH"}, LD:{stateCode:"LD",stateName:"LAKSHADWEEP"}, MH:{stateCode:"MH",stateName:"MAHARASHTRA"}, ML:{stateCode:"ML",stateName:"MEGHALAYA"},
  MN:{stateCode:"MN",stateName:"MANIPUR"}, MP:{stateCode:"MP",stateName:"MADHYA PRADESH"}, MZ:{stateCode:"MZ",stateName:"MIZORAM"}, NL:{stateCode:"NL",stateName:"NAGALAND"},
  OD:{stateCode:"OD",stateName:"ODISHA"}, OR:{stateCode:"OD",stateName:"ODISHA"}, PB:{stateCode:"PB",stateName:"PUNJAB"}, PY:{stateCode:"PY",stateName:"PONDICHERRY"},
  RJ:{stateCode:"RJ",stateName:"RAJASTHAN"}, SK:{stateCode:"SK",stateName:"SIKKIM"}, TN:{stateCode:"TN",stateName:"TAMIL NADU"}, TS:{stateCode:"TS",stateName:"TELANGANA"},
  TG:{stateCode:"TS",stateName:"TELANGANA"}, TR:{stateCode:"TR",stateName:"TRIPURA"}, UK:{stateCode:"UK",stateName:"UTTARAKHAND"}, UA:{stateCode:"UK",stateName:"UTTARAKHAND"},
  UP:{stateCode:"UP",stateName:"UTTAR PRADESH"}, WB:{stateCode:"WB",stateName:"WEST BENGAL"}
};

const STATE_ALIASES: Record<string,string> = {
  "TAMILNADU":"TAMIL NADU", "TAMIL NADU":"TAMIL NADU", "PUDUCHERRY":"PONDICHERRY", "PONDICHERRY":"PONDICHERRY",
  "ORISSA":"ODISHA", "ODISHA":"ODISHA", "UTTRAKHAND":"UTTARAKHAND", "UTTARANCHAL":"UTTARAKHAND", "UTTARAKHAND":"UTTARAKHAND",
  "JAMMU AND KASHMIR":"JAMMU & KASHMIR", "JAMMU & KASHMIR":"JAMMU & KASHMIR", "J & K":"JAMMU & KASHMIR",
  "CHATTISGARH":"CHHATTISGARH", "CHHATTISGARH":"CHHATTISGARH", "ANDRA PRADESH":"ANDHRA PRADESH", "ANDHRA PRADESH":"ANDHRA PRADESH",
  "TELENGANA":"TELANGANA", "TELANGANA":"TELANGANA", "NCR":"DELHI"
};

export function normalizeRtoCode(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/[_/]+/g, "-").replace(/--+/g, "-");
  const compact = raw.replace(/-/g, "");
  const match = compact.match(/^([A-Z]{2})([A-Z0-9]{1,8})$/);
  if (!match) return raw;
  const state = match[1];
  const rest = match[2];
  const numeric = rest.match(/^(\d{1,3})([A-Z0-9]*)$/);
  if (numeric) return `${state}-${numeric[1].length === 1 ? numeric[1].padStart(2,"0") : numeric[1]}${numeric[2] || ""}`;
  return `${state}-${rest}`;
}

export function normalizeStateName(value: unknown): string {
  const s = String(value ?? "").trim().toUpperCase().replace(/\s+/g," ").replace(/\.$/,"");
  return STATE_ALIASES[s] || s;
}

export function deriveStateFromRto(value: unknown): { stateCode: string; stateName: string } | null {
  const rto = normalizeRtoCode(value);
  const prefix = rto.slice(0,2);
  return RTO_PREFIX_STATE[prefix] || null;
}
