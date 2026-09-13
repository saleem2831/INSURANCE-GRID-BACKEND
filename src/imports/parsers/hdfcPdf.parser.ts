import { GridImportResult, ImportedCondition, ImportedRtoMapping, ImportedRule } from "../types";
import { PdfPageText } from "../pdfReader";
import { normalizeRto } from "./helpers";
import { derivationRule, pdfRule, pdfStatusRule } from "./pdfHelpers";
import { normalizeStateName } from "../../services/canonicalRto.service";

const PC_ZONE_FIELD = "insurerContext.hdfcPvtCarZone";

function state(value: string) { return normalizeStateName(value); }
function policyCondition(policyType: string): ImportedCondition {
  return { field: "policyType", operator: policyType === "COMP" ? "IN" : "EQUAL", value: policyType === "COMP" ? ["COMP", "COMP_1_1", "COMP_1_3"] : policyType };
}
function fuelPetrol(): ImportedCondition { return { field: "fuelType", operator: "IN", value: ["PETROL", "ELECTRIC", "HYBRID"] }; }
function fuelNonPetrol(): ImportedCondition { return { field: "fuelType", operator: "IN", value: ["DIESEL", "CNG", "LPG"] }; }

function volumeConditions(index: number): ImportedCondition[] {
  const field = "businessMetrics.monthlyGwp";
  switch (index) {
    case 0: return [{ field, operator: "LT", value: 10000 }];
    case 1: return [{ field, operator: "GTE", value: 10000 }, { field, operator: "LTE", value: 50000 }];
    case 2: return [{ field, operator: "GT", value: 50000 }, { field, operator: "LTE", value: 100000 }];
    case 3: return [{ field, operator: "GT", value: 100000 }, { field, operator: "LTE", value: 200000 }];
    default: return [{ field, operator: "GT", value: 200000 }];
  }
}

function addPrivateCarZoneDerivations(fileName: string, out: ImportedRule[]) {
  const direct: Array<[string,string]> = [
    ["BIHAR","ZONE_1"],["JHARKHAND","ZONE_1"],["WEST BENGAL","ZONE_1"],["ARUNACHAL PRADESH","ZONE_1"],
    ["CHHATTISGARH","ZONE_2"],["MANIPUR","ZONE_1"],["MEGHALAYA","ZONE_1"],["MIZORAM","ZONE_2"],["NAGALAND","ZONE_1"],
    ["ODISHA","ZONE_1"],["SIKKIM","ZONE_1"],["TRIPURA","ZONE_1"],["ANDHRA PRADESH","ZONE_1"],["KERALA","ZONE_2"],
    ["TELANGANA","ZONE_1"],["GOA","ZONE_1"],["MAHARASHTRA","ZONE_1"],["HARYANA","ZONE_2"],["HIMACHAL PRADESH","ZONE_2"],
    ["PUNJAB","ZONE_2"],["UTTAR PRADESH","ZONE_2"],["UTTARAKHAND","ZONE_2"],["JAMMU & KASHMIR","ZONE_2"],
    ["DELHI","ZONE_1"],["CHANDIGARH","ZONE_2"],["MADHYA PRADESH","ZONE_2"],["RAJASTHAN","ZONE_2"]
  ];
  for (const [st, zone] of direct) out.push(derivationRule({fileName,page:1,code:`HDFC-PC-ZONE-${st.replace(/[^A-Z0-9]+/g,"-")}`,product:"PRIVATE_CAR",conditions:[{field:"rtoState",operator:"EQUAL",value:st}],setField:PC_ZONE_FIELD,value:zone,priority:100,originalText:`HDFC PDF zone table: ${st} => ${zone}`}));

  // States with city/location splits. We intentionally require rtoRegion so the
  // engine asks for one extra field rather than assuming "rest of state".
  const split = (
    st: string,
    zone1Regions: string[],
    defaultZone: "ZONE_1"|"ZONE_2",
    specialZone: "ZONE_1"|"ZONE_2" = "ZONE_1"
  ) => {
    out.push(derivationRule({fileName,page:1,code:`HDFC-PC-ZONE-${st.replace(/[^A-Z0-9]+/g,"-")}-SPECIAL`,product:"PRIVATE_CAR",conditions:[{field:"rtoState",operator:"EQUAL",value:st},{field:"rtoRegion",operator:"IN",value:zone1Regions}],setField:PC_ZONE_FIELD,value:specialZone,priority:300,originalText:`HDFC PDF zone table: ${st}, ${zone1Regions.join(", ")} => ${specialZone}`}));
    out.push(derivationRule({fileName,page:1,code:`HDFC-PC-ZONE-${st.replace(/[^A-Z0-9]+/g,"-")}-REST`,product:"PRIVATE_CAR",conditions:[{field:"rtoState",operator:"EQUAL",value:st},{field:"rtoRegion",operator:"NOT_IN",value:zone1Regions}],setField:PC_ZONE_FIELD,value:defaultZone,priority:200,originalText:`HDFC PDF zone table: Rest of ${st} => ${defaultZone}`}));
  };
  split("ASSAM", ["KAMRUP", "REST OF ASSAM"], "ZONE_2", "ZONE_1");
  // Nagaon is Zone 2, while Kamrup/rest of Assam are Zone 1. Add an explicit override.
  out.push(derivationRule({fileName,page:1,code:"HDFC-PC-ZONE-ASSAM-NAGAON",product:"PRIVATE_CAR",conditions:[{field:"rtoState",operator:"EQUAL",value:"ASSAM"},{field:"rtoRegion",operator:"EQUAL",value:"NAGAON"}],setField:PC_ZONE_FIELD,value:"ZONE_2",priority:400,originalText:"HDFC PDF zone table: Assam / Nagaon => Zone 2"}));
  split("KARNATAKA", ["BANGALORE", "BENGALURU"], "ZONE_2", "ZONE_1");
  // Source lists Andamans in Zone 1 and Rest of Tamil Nadu in Zone 2.
  split("TAMIL NADU", ["ANDAMANS", "ANDAMAN", "ANDAMAN & NICOBAR"], "ZONE_2", "ZONE_1");
  split("GUJARAT", ["AHMEDABAD", "DADRA & NAGAR HAVELI", "DAMAN", "VADODARA"], "ZONE_2", "ZONE_1");

  // NCR is shown as a separate Zone-2 geography in the source. It is represented
  // as an RTO region so Delhi itself can still remain Zone 1 when the RTO is Delhi.
  out.push(derivationRule({fileName,page:2,code:"HDFC-PC-ZONE-NCR",product:"PRIVATE_CAR",conditions:[{field:"rtoRegion",operator:"EQUAL",value:"NCR"}],setField:PC_ZONE_FIELD,value:"ZONE_2",priority:500,originalText:"HDFC PDF zone table: NCR => Zone 2"}));
}

function addPrivateCarPayouts(fileName: string, out: ImportedRule[]) {
  const zone1 = {
    packPetrol:[17.5,19.5,21,23,25], packNonNcb:[17.5,19.5,21,23,25], packNonNoNcb:[11,12,13,14,15],
    saodPetrol:[17.5,19.5,21,23,25], saodNonNcb:[15,16,17,18,20], saodNonNoNcb:[11,12,13,14,15]
  };
  const zone2 = {
    packPetrol:[15,17.5,20,22,23], packNonNcb:[15,17.5,20,22,23], packNonNoNcb:[10,10,12,12,12.5],
    saodPetrol:[15,17.5,20,22,23], saodNonNcb:[11,12,13,14,15], saodNonNoNcb:[10,10,10,10.5,10.5]
  };
  const tables: Array<["ZONE_1"|"ZONE_2",typeof zone1]> = [["ZONE_1",zone1],["ZONE_2",zone2]];
  for (const [zone, t] of tables) for (let i=0;i<5;i++) {
    const base: ImportedCondition[] = [{field:PC_ZONE_FIELD,operator:"EQUAL",value:zone},...volumeConditions(i)];
    const push = (suffix:string,policyType:string,fuel:ImportedCondition,pct:number,ncbMode:"ANY"|"NCB"|"NON_NCB") => {
      const c: ImportedCondition[] = [...base,policyCondition(policyType),fuel];
      if (ncbMode === "NCB") c.push({field:"ncb",operator:"GT",value:0});
      if (ncbMode === "NON_NCB") { c.push({field:"ncb",operator:"EQUAL",value:0},{field:"businessType",operator:"NOT_EQUAL",value:"NEW"}); }
      out.push(pdfRule({fileName,page:zone==="ZONE_1"?1:1,code:`HDFC-PC-${zone}-S${i+1}-${suffix}`,product:"PRIVATE_CAR",conditions:c,percentage:pct,basis:"OD",priority:350,originalText:`HDFC Private Car PDF ${zone} slab ${i+1} ${suffix} = ${pct}%`}));
      // Source note: New Business is considered NCB. Duplicate NCB rule with explicit NEW business.
      if (ncbMode === "NCB") out.push(pdfRule({fileName,page:1,code:`HDFC-PC-${zone}-S${i+1}-${suffix}-NEW`,product:"PRIVATE_CAR",conditions:[...base,policyCondition(policyType),fuel,{field:"businessType",operator:"EQUAL",value:"NEW"}],percentage:pct,basis:"OD",priority:360,originalText:`HDFC Private Car PDF ${zone} slab ${i+1} ${suffix}; New Business considered NCB = ${pct}%`}));
    };
    push("PACK-PETROL","COMP",fuelPetrol(),t.packPetrol[i],"ANY");
    push("PACK-NONPETROL-NCB","COMP",fuelNonPetrol(),t.packNonNcb[i],"NCB");
    push("PACK-NONPETROL-NONNCB","COMP",fuelNonPetrol(),t.packNonNoNcb[i],"NON_NCB");
    push("SAOD-PETROL","SAOD",fuelPetrol(),t.saodPetrol[i],"ANY");
    push("SAOD-NONPETROL-NCB","SAOD",fuelNonPetrol(),t.saodNonNcb[i],"NCB");
    push("SAOD-NONPETROL-NONNCB","SAOD",fuelNonPetrol(),t.saodNonNoNcb[i],"NON_NCB");
  }
}

function parsePrivateCarPdf(pages: PdfPageText[], fileName: string): {rules:ImportedRule[]; mappings:ImportedRtoMapping[]} {
  const joined = pages.map(p=>p.text).join("\n");
  if (!/Effective from 1st Feb'?25/i.test(joined) || !/Zone\s*1/i.test(joined) || !/Slab will be calculated basis comprehensive/i.test(joined)) return {rules:[],mappings:[]};
  const rules:ImportedRule[]=[];
  addPrivateCarZoneDerivations(fileName,rules);
  addPrivateCarPayouts(fileName,rules);
  return {rules,mappings:[]};
}

function addMapping(mappings: ImportedRtoMapping[], fileName:string, page:number, codes:string[], region:string, stateName="MAHARASHTRA") {
  for (const raw of codes) {
    const code = normalizeRto(raw);
    if (!/^[A-Z]{2}-\d{2}$/.test(code)) continue;
    mappings.push({rtoCode:code,originalRtoCode:raw,product:"GCV",cluster:region,region,state:stateName,location:region,mappingClass:"REGION",source:{fileName,sheet:`PDF Page ${page}`,row:page}});
  }
}

function baseRegionConditions(region:string): ImportedCondition[] {
  if (region === "GOA") return [{field:"rtoState",operator:"EQUAL",value:"GOA"}];
  if (region === "OTHERS_2") return [{field:"rtoState",operator:"EQUAL",value:"MAHARASHTRA"}];
  return [{field:"rtoState",operator:"EQUAL",value:"MAHARASHTRA"},{field:"rtoRegion",operator:"EQUAL",value:region}];
}

function parseGcvPdf(pages: PdfPageText[], fileName: string): {rules:ImportedRule[];mappings:ImportedRtoMapping[]} {
  const joined=pages.map(p=>p.text).join("\n");
  if(!/GCV Grid Effective 01 Apr 2026/i.test(joined)||!/4W\s*:\s*2\.5T-3\.5T/i.test(joined))return{rules:[],mappings:[]};
  const rules:ImportedRule[]=[]; const mappings:ImportedRtoMapping[]=[]; const page=pages[0]?.page||1;
  addMapping(mappings,fileName,page,["MH-01","MH-02","MH-03","MH-04","MH-05","MH-43","MH-46","MH-47","MH-56","MH-48","MH-58"],"MUMBAI");
  addMapping(mappings,fileName,page,["MH-12","MH-53","MH-54","MH-55","MH-14"],"PUNE");
  addMapping(mappings,fileName,page,["MH-07","MH-08","MH-09","MH-10","MH-11","MH-42"],"GOOD");
  addMapping(mappings,fileName,page,["MH-15","MH-51","MH-61"],"NASHIK");
  addMapping(mappings,fileName,page,["MH-31","MH-40","MH-49"],"NAGPUR");

  const regions: Array<[string,string,number,number]> = [
    ["MUMBAI", "Mumbai, Pune, Goa", 60,60], ["PUNE","Mumbai, Pune, Goa",60,60],["GOA","Mumbai, Pune, Goa",60,60],
    ["NAGPUR","Nagpur, Nashik",30,30],["NASHIK","Nagpur, Nashik",30,30],["GOOD","Good",60,60],["OTHERS_2","Others 2",30,30]
  ];
  for (const [region,label,comp,satp] of regions) {
    const geo=baseRegionConditions(region);
    for(const [pt,pct] of [["COMP",comp],["SATP",satp]] as const) rules.push(pdfRule({fileName,page,code:`HDFC-GCV-3W-${region}-${pt}`,product:"GCV",conditions:[...geo,{field:"vehicleType",operator:"EQUAL",value:"3W"},policyCondition(pt)],percentage:pct,basis:pt==="SATP"?"TP":"GWP",priority:region==="OTHERS_2"?100:300,originalText:`HDFC GCV PDF 3W ${label} ${pt} ${pct}%`}));
  }

  const fourLow: Array<[string,string,number,number]> = [["MUMBAI","Mumbai, Pune, Goa",55,55],["PUNE","Mumbai, Pune, Goa",55,55],["GOA","Mumbai, Pune, Goa",55,55],["NAGPUR","Nagpur, Nashik",30,45],["NASHIK","Nagpur, Nashik",30,45],["GOOD","Good",50,55],["OTHERS_2","Others 2",50,55]];
  for(const [region,label,comp,satp] of fourLow){const geo=baseRegionConditions(region); for(const [pt,pct] of [["COMP",comp],["SATP",satp]] as const){
    const common:ImportedCondition[]=[...geo,{field:"vehicleType",operator:"NOT_EQUAL",value:"3W"},{field:"gvw",operator:"LTE",value:2500},policyCondition(pt)];
    rules.push(pdfRule({fileName,page,code:`HDFC-GCV-4W-0-2500-${region}-${pt}-OTHER`,product:"GCV",conditions:[...common,{field:"make",operator:"NOT_EQUAL",value:"TATA"}],percentage:pct,basis:pt==="SATP"?"TP":"GWP",priority:region==="OTHERS_2"?120:320,originalText:`HDFC GCV PDF 4W 0-2.5T ${label} ${pt}: ${pct}% otherwise`}));
    if(["MUMBAI","PUNE","GOA"].includes(region))rules.push(pdfRule({fileName,page,code:`HDFC-GCV-4W-0-2500-${region}-${pt}-TATA`,product:"GCV",conditions:[...common,{field:"make",operator:"EQUAL",value:"TATA"}],percentage:60,basis:pt==="SATP"?"TP":"GWP",priority:500,originalText:`HDFC GCV PDF 4W 0-2.5T ${label} ${pt}: 60% in Tata`}));
  }}

  const add25to35=(region:string,label:string,compOther:number,satpOther:number,boleroYoung?:number,boleroOld?:number,declineYoung=false,otherYoung?:number,otherOld?:number)=>{
    const geo=baseRegionConditions(region); for(const pt of ["COMP","SATP"] as const){const common:ImportedCondition[]=[...geo,{field:"vehicleType",operator:"NOT_EQUAL",value:"3W"},{field:"gvw",operator:"GT",value:2500},{field:"gvw",operator:"LTE",value:3500},policyCondition(pt)];
      // Generic "other" payout. More-specific Bolero override/exclusion wins when model is supplied.
      if(otherYoung!==undefined&&otherOld!==undefined){rules.push(pdfRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-OTHER-YOUNG`,product:"GCV",conditions:[...common,{field:"vehicleAge",operator:"LT",value:5}],percentage:otherYoung,basis:pt==="SATP"?"TP":"GWP",priority:region==="OTHERS_2"?140:340,originalText:`HDFC GCV PDF 2.5-3.5T ${label}: others <5 years ${otherYoung}%`}));rules.push(pdfRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-OTHER-OLD`,product:"GCV",conditions:[...common,{field:"vehicleAge",operator:"GTE",value:5}],percentage:otherOld,basis:pt==="SATP"?"TP":"GWP",priority:region==="OTHERS_2"?140:340,originalText:`HDFC GCV PDF 2.5-3.5T ${label}: others >5 years ${otherOld}%`}));}
      else rules.push(pdfRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-OTHER`,product:"GCV",conditions:common,percentage:pt==="COMP"?compOther:satpOther,basis:pt==="SATP"?"TP":"GWP",priority:region==="OTHERS_2"?140:340,originalText:`HDFC GCV PDF 2.5-3.5T ${label}: others ${pt==="COMP"?compOther:satpOther}%`}));
      if(declineYoung)rules.push(pdfStatusRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-BOLERO-DECLINE`,product:"GCV",conditions:[...common,{field:"model",operator:"EQUAL",value:"BOLERO"},{field:"vehicleAge",operator:"LT",value:5}],type:"DECLINE",priority:9000,reason:`HDFC source: Bolero age 0-4 decline in ${label}`}));
      if(boleroYoung!==undefined)rules.push(pdfRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-BOLERO-YOUNG`,product:"GCV",conditions:[...common,{field:"model",operator:"EQUAL",value:"BOLERO"},{field:"vehicleAge",operator:"LT",value:5}],percentage:boleroYoung,basis:pt==="SATP"?"TP":"GWP",priority:1200,kind:"OVERRIDE",originalText:`HDFC GCV PDF 2.5-3.5T ${label}: Bolero <5 years ${boleroYoung}%`}));
      if(boleroOld!==undefined)rules.push(pdfRule({fileName,page,code:`HDFC-GCV-25-35-${region}-${pt}-BOLERO-OLD`,product:"GCV",conditions:[...common,{field:"model",operator:"EQUAL",value:"BOLERO"},{field:"vehicleAge",operator:"GTE",value:5}],percentage:boleroOld,basis:pt==="SATP"?"TP":"GWP",priority:1200,kind:"OVERRIDE",originalText:`HDFC GCV PDF 2.5-3.5T ${label}: Bolero >5 years ${boleroOld}%`}));
    }};
  add25to35("MUMBAI","Mumbai, Pune, Goa",45,45,37.5,42.5,false,45,52.5); add25to35("PUNE","Mumbai, Pune, Goa",45,45,37.5,42.5,false,45,52.5); add25to35("GOA","Mumbai, Pune, Goa",45,45,37.5,42.5,false,45,52.5);
  add25to35("NAGPUR","Nagpur, Nashik",30,35,undefined,undefined,true); add25to35("NASHIK","Nagpur, Nashik",30,35,undefined,undefined,true);
  add25to35("GOOD","Good",40,40,30,50,false,40,50); add25to35("OTHERS_2","Others 2",30,35,undefined,undefined,true);
  return {rules,mappings};
}

export function parseHdfcPdf(pages: PdfPageText[], context:{fileName:string;version:string}): GridImportResult {
  const pc=parsePrivateCarPdf(pages,context.fileName); const gcv=parseGcvPdf(pages,context.fileName);
  const rules=[...pc.rules,...gcv.rules],rtoMappings=[...pc.mappings,...gcv.mappings];
  const warnings=[
    "HDFC PDF parser is template-locked to the supplied GCV 01-Apr-2026 and Private-Car 01-Feb-2025 PDFs. A changed PDF layout must be revalidated before activation.",
    "HDFC Private-Car zone splits require rtoRegion for split states; the engine returns NEEDS_INPUT rather than assuming a zone."
  ];
  return {insurerCode:"HDFC_ERGO",fileName:context.fileName,rules,rtoMappings,warnings,errors:(rules.length||rtoMappings.length)?[]:["HDFC_PDF_FORMAT_CHANGED: supplied PDF did not match either validated HDFC PDF template."]};
}
