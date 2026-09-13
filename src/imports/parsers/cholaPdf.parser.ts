import { GridImportResult, ImportedCondition, ImportedRule } from "../types";
import { PdfPageText } from "../pdfReader";
import { rangeConditions, slug } from "./helpers";
import { derivationRule, pdfRule, pdfStatusRule, percentTokens } from "./pdfHelpers";
import { normalizeStateName } from "../../services/canonicalRto.service";

const SINGLE_STATE_MARKETS: Record<string,string> = {
  "TELANGANA":"TELANGANA", "GOA":"GOA", "GUJARAT":"GUJARAT", "BIHAR":"BIHAR", "JHARKHAND":"JHARKHAND", "ODISHA":"ODISHA",
  "WEST BENGAL":"WEST BENGAL", "CHATTISGARH":"CHHATTISGARH", "DELHI":"DELHI", "PUNJAB":"PUNJAB", "HIMACHAL PRADESH":"HIMACHAL PRADESH",
  "JAMMU KASHMIR":"JAMMU & KASHMIR", "UTTARAKHAND":"UTTARAKHAND", "ANDAMAN NICOBAR":"ANDAMAN & NICOBAR", "RAJASTHAN":"RAJASTHAN", "MADHYA PRADESH":"MADHYA PRADESH"
};

function firstTitle(page: PdfPageText): string {
  return (page.text.split(/\n/).map(x=>x.trim()).find(Boolean) || `PAGE_${page.page}`).toUpperCase().replace(/\s+/g," ");
}

function marketConditions(title: string): ImportedCondition[] {
  const exact = SINGLE_STATE_MARKETS[title];
  if (exact) return [{ field:"rtoState", operator:"EQUAL", value: exact }];
  if (title.startsWith("ASSAM,")) return [{ field:"rtoState", operator:"IN", value:["ASSAM","MEGHALAYA","TRIPURA","ARUNACHAL PRADESH","NAGALAND","MIZORAM","MANIPUR","SIKKIM"] }];
  if (title.startsWith("ANDHRA PRADESH")) return [{ field:"rtoState", operator:"EQUAL", value:"ANDHRA PRADESH" }];
  return [{ field:"insurerContext.cholaMarket", operator:"EQUAL", value:title }];
}

function ccConditions(label: string): ImportedCondition[] {
  const s = label.toUpperCase();
  if (/UPTO\s*1000/.test(s)) return [{field:"cc",operator:"LTE",value:1000}];
  if (/1000\s*TO\s*1500/.test(s)) return [{field:"cc",operator:"GT",value:1000},{field:"cc",operator:"LTE",value:1500}];
  if (/ABOVE\s*1500/.test(s)) return [{field:"cc",operator:"GT",value:1500}];
  if (/LT\s*1500/.test(s)) return [{field:"cc",operator:"LT",value:1500}];
  if (/GT\s*1500/.test(s)) return [{field:"cc",operator:"GT",value:1500}];
  return [];
}

function privateCarRules(page: PdfPageText, fileName: string, title: string): ImportedRule[] {
  const out: ImportedRule[] = [];
  const lines = page.text.split(/\n/);
  let fuel = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+/g," ").trim();
    if (/PC PETROL/i.test(line)) fuel = "PETROL";
    if (/PC DIESEL/i.test(line)) fuel = "DIESEL";
    if (!fuel || !/(UPTO 1000 CC|1000 TO 1500 CC|ABOVE 1500 CC)/i.test(line)) continue;
    const pcts = percentTokens(line);
    if (pcts.length < 3) continue;
    const label = line.match(/(UPTO 1000 CC|1000 TO 1500 CC|ABOVE 1500 CC)/i)?.[1] || line;
    const base: ImportedCondition[] = [...marketConditions(title), ...ccConditions(label)];
    base.push({ field:"fuelType", operator: fuel === "PETROL" ? "IN" : "EQUAL", value: fuel === "PETROL" ? ["PETROL","ELECTRIC","LPG","CNG"] : "DIESEL" });
    // Source columns: ACT, Package without NCB, Package NCB>=25, SOD without NCB, SOD NCB>=25.
    // Some rows use '-' for ACT, therefore pcts may contain only four values. Detect from source text.
    const hasAct = !/\s-\s/.test(line.slice(line.indexOf(label)+label.length, line.indexOf(label)+label.length+80));
    const values = pcts;
    let act:number|undefined, pack0:number|undefined, pack25:number|undefined, sod0:number|undefined, sod25:number|undefined;
    if (values.length >= 5) [act,pack0,pack25,sod0,sod25] = values.slice(-5);
    else if (values.length === 4) [pack0,pack25,sod0,sod25] = values;
    else if (values.length === 3) [act,pack0,pack25] = values;
    const prefix = `CHOLA-P${page.page}-${slug(title)}-${slug(fuel)}-${slug(label)}`;
    if (act !== undefined && hasAct) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-ACT`,product:"PRIVATE_CAR",conditions:[...base,{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]}],percentage:act,basis:"TP",priority:300,originalText:line}));
    if (pack0 !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-COMP-NCB0`,product:"PRIVATE_CAR",conditions:[...base,{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3"]},{field:"ncb",operator:"EQUAL",value:0}],percentage:pack0,basis:"OD",priority:300,originalText:line}));
    if (pack25 !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-COMP-NCB25`,product:"PRIVATE_CAR",conditions:[...base,{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3"]},{field:"ncb",operator:"GTE",value:25}],percentage:pack25,basis:"OD",priority:310,originalText:line}));
    if (sod0 !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-SAOD-NCB0`,product:"PRIVATE_CAR",conditions:[...base,{field:"policyType",operator:"EQUAL",value:"SAOD"},{field:"ncb",operator:"EQUAL",value:0}],percentage:sod0,basis:"OD",priority:300,originalText:line}));
    if (sod25 !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-SAOD-NCB25`,product:"PRIVATE_CAR",conditions:[...base,{field:"policyType",operator:"EQUAL",value:"SAOD"},{field:"ncb",operator:"GTE",value:25}],percentage:sod25,basis:"OD",priority:310,originalText:line}));
  }
  return out;
}

function commercialRules(page: PdfPageText, fileName: string, title: string): ImportedRule[] {
  const out: ImportedRule[] = [];
  const lines = page.text.split(/\n/);
  let section: "GCV"|"PCV_LT6"|"PCV_GT6"|"MSV"|"" = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+/g," ").trim();
    if (/^GCCV\b/i.test(line) || /\sGCCV\s/i.test(line)) section = "GCV";
    if (/PCCV<6/i.test(line)) section = "PCV_LT6";
    if (/PCCV>6/i.test(line)) section = "PCV_GT6";
    if (/\bMSV\b/i.test(line)) section = "MSV";
    if (!section || section === "MSV") continue;
    const pcts = percentTokens(line);
    if (pcts.length < 1) continue;
    const act = pcts.length >= 2 ? pcts[pcts.length-2] : undefined;
    const pack = pcts[pcts.length-1];
    let label = line.replace(/\d+(?:\.\d+)?%/g,"").replace(/^GCCV\s*/i,"").trim();
    if (!label || /PROD\s+SUBCLASS/i.test(label)) continue;
    const product = section === "GCV" ? "GCV" : "PCV";
    const common: ImportedCondition[] = [...marketConditions(title)];
    if (section === "PCV_LT6") common.push({field:"seatingCapacity",operator:"LTE",value:6});
    if (section === "PCV_GT6") common.push({field:"seatingCapacity",operator:"GT",value:6});
    if (/3W/i.test(label)) common.push({field:"vehicleType",operator:"EQUAL",value:"3W"});
    if (/ELECTRIC/i.test(label)) common.push({field:"fuelType",operator:"EQUAL",value:"ELECTRIC"});
    if (/SCHOOL BUS/i.test(label)) common.push({field:"vehicleUse",operator:"EQUAL",value:"SCHOOL"});
    if (/STAFF BUS/i.test(label)) common.push({field:"vehicleUse",operator:"EQUAL",value:"STAFF"});
    if (/BIG TAXIS|TAXI/i.test(label)) common.push({field:"vehicleUse",operator:"EQUAL",value:"TAXI"});
    if (/MAXI CAB/i.test(label)) common.push({field:"vehicleUse",operator:"EQUAL",value:"MAXI_CAB"});
    if (product === "GCV") common.push(...rangeConditions("gvw", label));
    if (/TATA\s*\/\s*MARUTI\s*\/\s*MAHINDRA/i.test(label)) common.push({field:"make",operator:"IN",value:["TATA","MARUTI","MARUTI SUZUKI","MAHINDRA"]});
    if (/ALL OTHER MAKE/i.test(label)) common.push({field:"make",operator:"NOT_IN",value:["TATA","MARUTI","MARUTI SUZUKI","MAHINDRA"]});
    const prefix = `CHOLA-P${page.page}-${slug(title)}-${section}-${slug(label)}`;
    if (act !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-ACT`,product,conditions:[...common,{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]}],percentage:act,basis:"NET",priority:250,originalText:line}));
    if (pack !== undefined) out.push(pdfRule({fileName,page:page.page,code:`${prefix}-PACK`,product,conditions:[...common,{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3","COMP_1_5"]}],percentage:pack,basis:"NET",priority:250,originalText:line}));
  }
  // Explicit source exclusion.
  out.push(pdfStatusRule({fileName,page:page.page,code:`CHOLA-P${page.page}-GCV-EV-GT35-DECLINE`,product:"GCV",conditions:[...marketConditions(title),{field:"fuelType",operator:"EQUAL",value:"ELECTRIC"},{field:"gvw",operator:"GT",value:3500}],type:"DECLINE",priority:2000,reason:"Chola source: GCCV EV exceeding 3.5T is declined."}));
  out.push(pdfStatusRule({fileName,page:page.page,code:`CHOLA-P${page.page}-PCV-EV-DECLINE`,product:"PCV",conditions:[...marketConditions(title),{field:"fuelType",operator:"EQUAL",value:"ELECTRIC"},{field:"vehicleType",operator:"NOT_EQUAL",value:"3W"}],type:"DECLINE",priority:2000,reason:"Chola source: Passenger Carrying EV except e-Auto is declined."}));
  return out;
}

export function parseCholaPdf(pages: PdfPageText[], context: {fileName:string;version:string}): GridImportResult {
  const rules: ImportedRule[] = [];
  const warnings: string[] = [];
  for (const page of pages) {
    if (!page.text.trim()) continue;
    const title = firstTitle(page);
    rules.push(...privateCarRules(page, context.fileName, title));
    rules.push(...commercialRules(page, context.fileName, title));
    const state = SINGLE_STATE_MARKETS[title];
    if (state) rules.push(derivationRule({fileName:context.fileName,page:page.page,code:`CHOLA-${slug(title)}-MARKET`,conditions:[{field:"rtoState",operator:"EQUAL",value:normalizeStateName(state)}],setField:"insurerContext.cholaMarket",value:title,priority:50}));
  }
  warnings.push("Chola PDF Two-Wheeler make/NOP matrix is retained for review and is not auto-executed in V7. Private Car/GCV/PCV tables are executable. Split markets (e.g. Chennai/Rest TN, Bangalore/Rest Karnataka, Mumbai/Pune/Rest Maharashtra, UP East) may require insurerContext.cholaMarket until a validated RTO-to-market mapping is supplied.");
  if (!rules.length) return {insurerCode:"CHOLA_MS",fileName:context.fileName,rules:[],rtoMappings:[],warnings,errors:["CHOLA_PDF_PARSE_FAILED: no deterministic motor rules were extracted."]};
  return {insurerCode:"CHOLA_MS",fileName:context.fileName,rules,rtoMappings:[],warnings,errors:[]};
}
