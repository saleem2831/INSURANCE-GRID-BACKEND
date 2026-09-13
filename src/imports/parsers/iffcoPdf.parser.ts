import { GridImportResult, ImportedCondition, ImportedRule } from "../types";
import { PdfPageText } from "../pdfReader";
import { derivationRule, pdfRule, pdfStatusRule } from "./pdfHelpers";
import { normalizeStateName } from "../../services/canonicalRto.service";

const MUMBAI_RTOS = ["MH-01","MH-02","MH-03","MH-04","MH-05","MH-06","MH-43","MH-46","MH-47","MH-48","MH-56","MH-58"];
const NCR_AS_DELHI = ["HR-38","HR-87","HR-98","HR-51","HR-29","HR-55","HR-72","HR-26","UP-16","UP-14"];

const COMP_STATES = ["ASSAM","DELHI","UTTARAKHAND","CHHATTISGARH","MADHYA PRADESH","BIHAR","UTTAR PRADESH","RAJASTHAN","HARYANA","HIMACHAL PRADESH","JAMMU & KASHMIR","PUNJAB","JHARKHAND","ODISHA","WEST BENGAL","GUJARAT","MAHARASHTRA","MUMBAI","GOA","ANDHRA PRADESH","TELANGANA","KARNATAKA","KERALA","TAMIL NADU"];

const SATP_COLUMNS = [
  "PC_LT1000","PC_1000_1500","PC_GT1500","TWP","A1_LT7500","A1_7500_40000","A1_GT40000","A2_A3_A4","BUS_11_18","BUS_19_60","C1B_AUTO","C1A_TAXI","C2_MAXICAB","D_OTHER"
];

const SATP_MATRIX: Record<string,string> = {
  "DELHI":"RRGGRRRRGRRGGR", "HARYANA":"RRRGRRRRGRGGRR", "HIMACHAL PRADESH":"RGGGGGGRGGGGGR", "JAMMU & KASHMIR":"RGGGGGGGRRRRGR",
  "MADHYA PRADESH":"RRRRRRRRRRRGGR", "PUNJAB":"RRGGRRRRGRGGRR", "RAJASTHAN":"RRRRGGRGGRGRGR", "UTTAR PRADESH":"RRGRRRRRGRRGGR",
  "UTTARAKHAND":"RRGGGGRRGGGGRR", "ASSAM":"RGGRGRGRGGGGGR", "NE_EX_ASSAM":"GGGGGGGGGGGGGG", "BIHAR":"RGGGGGRGGGGGGG",
  "CHHATTISGARH":"RRGRRGRGRRGGGG", "JHARKHAND":"GGGGGGRGGGGGRG", "ODISHA":"RGGGGGGGGRGGGG", "WEST BENGAL":"RGGGRGGGGRGGGG",
  "GOA":"RGGGGGGGRGGGGG", "GUJARAT":"RRGGGGGGGRGGGR", "MAHARASHTRA":"RRGRGGRGGRGGRR", "MUMBAI":"GGGGGGGGGRGGRR",
  "ANDHRA PRADESH":"RRGGRGRGGRGGGR", "KARNATAKA":"RRGRGRRRRRRRGR", "KERALA":"RGGRGGRRGRGGGR", "TAMIL NADU":"RRGRGGGRRRRGGR",
  "TELANGANA":"RRGGGGGGGGGGGR", "HO":"RRGGGGRRRRRGRG", "MNC":"RGGGRGGGGGRGGG"
};

function geoConditions(state: string): ImportedCondition[][] {
  const s = normalizeStateName(state);
  if (s === "MUMBAI") return [[{field:"rtoCode",operator:"IN",value:MUMBAI_RTOS}]];
  if (s === "DELHI") return [
    [{field:"rtoState",operator:"EQUAL",value:"DELHI"}],
    [{field:"rtoCode",operator:"IN",value:NCR_AS_DELHI}]
  ];
  if (s === "MAHARASHTRA") return [[{field:"rtoState",operator:"EQUAL",value:"MAHARASHTRA"},{field:"rtoCode",operator:"NOT_IN",value:MUMBAI_RTOS}]];
  if (state === "NE_EX_ASSAM") return [[{field:"rtoState",operator:"IN",value:["ARUNACHAL PRADESH","MEGHALAYA","MANIPUR","MIZORAM","NAGALAND","SIKKIM","TRIPURA"]}]];
  if (state === "HO" || state === "MNC") return [[{field:"insurerContext.iffcoOfficeClass",operator:"EQUAL",value:state}]];
  return [[{field:"rtoState",operator:"EQUAL",value:s}]];
}

function compSegmentDerivations(fileName:string): ImportedRule[] {
  const r: ImportedRule[] = [];
  const add=(code:string,product:string,conditions:ImportedCondition[],value:string,prio=200)=>r.push(derivationRule({fileName,page:8,code,product,conditions,setField:"insurerContext.iffcoCompSegment",value,priority:prio}));
  add("IFFCO-CSEG-GCV-3W-PUBLIC","GCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"},{field:"carrierType",operator:"EQUAL",value:"PUBLIC"}],"A3-THREE WHEELER (PUBLIC)",500);
  add("IFFCO-CSEG-GCV-3W-PRIVATE","GCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"},{field:"carrierType",operator:"EQUAL",value:"PRIVATE"}],"A4-THREE WHEELER (PRIVATE)",500);
  add("IFFCO-CSEG-GCV-PRIVATE","GCV",[{field:"carrierType",operator:"EQUAL",value:"PRIVATE"}],"A2-GOODS CARRYING (PRIVATE)",400);
  for (const [code,conds,value] of [
    ["LT7500",[{field:"gvw",operator:"LTE",value:7500}],"A.1 GVW upto 7500 kg"],
    ["7500-12000",[{field:"gvw",operator:"GT",value:7500},{field:"gvw",operator:"LTE",value:12000}],"A.1 GVW 7500-12000 kg"],
    ["12000-20000",[{field:"gvw",operator:"GT",value:12000},{field:"gvw",operator:"LTE",value:20000}],"A.1 GVW 12000-20000 kg"],
    ["20000-40000",[{field:"gvw",operator:"GT",value:20000},{field:"gvw",operator:"LTE",value:40000}],"A.1 GVW 20000-40000 kg"],
    ["GT40000",[{field:"gvw",operator:"GT",value:40000}],"A.1 GVW GT 40000 kg"]
  ] as any[]) add(`IFFCO-CSEG-GCV-${code}`,"GCV",[{field:"carrierType",operator:"NOT_EQUAL",value:"PRIVATE"},...conds],value,300);
  add("IFFCO-CSEG-PCV-3W","PCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"}],"C3-THREE WHEELERS",500);
  add("IFFCO-CSEG-PCV-TAXI","PCV",[{field:"vehicleUse",operator:"EQUAL",value:"TAXI"}],"C1A-TAXI",500);
  const bands: Array<[number, number | null, string]> = [[11,18,"C2- SEATING CAPACITY 11-18"],[19,36,"C2- SEATING CAPACITY 19-36"],[37,60,"C2- SEATING CAPACITY 37-60"],[61,null,"C2- SEATING CAPACITY GREATER THAN 60"]];
  for(const [lo,hi,value] of bands){const c:ImportedCondition[]=[{field:"seatingCapacity",operator:"GTE",value:lo}];if(hi)c.push({field:"seatingCapacity",operator:"LTE",value:hi});add(`IFFCO-CSEG-PCV-${lo}-${hi||"PLUS"}`,"PCV",c,value,250);}
  add("IFFCO-CSEG-TW","TWO_WHEELER",[],"C4-TWO WHEELERS",100);
  return r;
}

function satpSegmentDerivations(fileName:string): ImportedRule[] {
  const r:ImportedRule[]=[];
  const add=(code:string,product:string,conditions:ImportedCondition[],value:string,prio=200)=>r.push(derivationRule({fileName,page:9,code,product,conditions,setField:"insurerContext.iffcoSatpSegment",value,priority:prio}));
  add("IFFCO-SSEG-PC-LT1000","PRIVATE_CAR",[{field:"cc",operator:"LTE",value:1000}],"PC_LT1000");
  add("IFFCO-SSEG-PC-1000-1500","PRIVATE_CAR",[{field:"cc",operator:"GT",value:1000},{field:"cc",operator:"LTE",value:1500}],"PC_1000_1500");
  add("IFFCO-SSEG-PC-GT1500","PRIVATE_CAR",[{field:"cc",operator:"GT",value:1500}],"PC_GT1500");
  add("IFFCO-SSEG-TW","TWO_WHEELER",[],"TWP");
  add("IFFCO-SSEG-GCV-A234","GCV",[{field:"carrierType",operator:"EQUAL",value:"PRIVATE"}],"A2_A3_A4",450);
  add("IFFCO-SSEG-GCV-3W","GCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"}],"A2_A3_A4",500);
  add("IFFCO-SSEG-GCV-LT7500","GCV",[{field:"gvw",operator:"LTE",value:7500}],"A1_LT7500",250);
  add("IFFCO-SSEG-GCV-7500-40000","GCV",[{field:"gvw",operator:"GT",value:7500},{field:"gvw",operator:"LTE",value:40000}],"A1_7500_40000",250);
  add("IFFCO-SSEG-GCV-GT40000","GCV",[{field:"gvw",operator:"GT",value:40000}],"A1_GT40000",250);
  add("IFFCO-SSEG-PCV-3W","PCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"}],"C1B_AUTO",500);
  add("IFFCO-SSEG-PCV-TAXI","PCV",[{field:"vehicleUse",operator:"EQUAL",value:"TAXI"},{field:"seatingCapacity",operator:"LTE",value:6}],"C1A_TAXI",500);
  add("IFFCO-SSEG-PCV-MAXI","PCV",[{field:"seatingCapacity",operator:"GTE",value:7},{field:"seatingCapacity",operator:"LTE",value:10}],"C2_MAXICAB",400);
  add("IFFCO-SSEG-PCV-BUS11-18","PCV",[{field:"seatingCapacity",operator:"GTE",value:11},{field:"seatingCapacity",operator:"LTE",value:18}],"BUS_11_18",300);
  add("IFFCO-SSEG-PCV-BUS19-60","PCV",[{field:"seatingCapacity",operator:"GTE",value:19},{field:"seatingCapacity",operator:"LTE",value:60}],"BUS_19_60",300);
  return r;
}

function compHeatmapRules(pages:PdfPageText[],fileName:string): ImportedRule[] {
  const page=pages.find(p=>/Comprehensive Commercial Vehicle Heat Map/i.test(p.text));
  if(!page)return[];
  const out:ImportedRule[]=[];
  for(const [lineNo,raw] of page.text.split(/\n/).entries()){
    const colors=[...raw.matchAll(/\b(GREEN|RED)\b/gi)].map(m=>m[1].toUpperCase());
    if(colors.length!==COMP_STATES.length)continue;
    const first=raw.search(/\b(?:GREEN|RED)\b/i); if(first<1)continue;
    const segment=raw.slice(0,first).trim().replace(/\s+/g," ");
    for (let i = 0; i < COMP_STATES.length; i++) {
      const variants = geoConditions(COMP_STATES[i]);
      for (let g = 0; g < variants.length; g++) {
        const geo = variants[g];
        out.push(derivationRule({fileName,page:page.page,code:`IFFCO-CZONE-P${page.page}-L${lineNo+1}-${COMP_STATES[i].replace(/[^A-Z0-9]+/gi,"-")}-${i}-G${g+1}-${segment.replace(/[^A-Z0-9]+/gi,"-")}`,product:"ALL",conditions:[{field:"insurerContext.iffcoCompSegment",operator:"EQUAL",value:segment},...geo],setField:"insurerContext.iffcoCompZone",value:colors[i],priority:600,originalText:raw}));
      }
    }
  }
  return out;
}

function satpHeatmapRules(fileName:string): ImportedRule[] {
  const out:ImportedRule[]=[];
  for(const [state,bits] of Object.entries(SATP_MATRIX)){
    SATP_COLUMNS.forEach((segment,i)=>{
      const zone=bits[i]==="G"?"GREEN":"RED";
      const variants = geoConditions(state);
      for (let g = 0; g < variants.length; g++) {
        const geo = variants[g];
        out.push(derivationRule({fileName,page:9,code:`IFFCO-SZONE-${state.replace(/[^A-Z0-9]+/g,"-")}-${segment}-G${g+1}`,product:"ALL",conditions:[{field:"insurerContext.iffcoSatpSegment",operator:"EQUAL",value:segment},...geo],setField:"insurerContext.iffcoSatpZone",value:zone,priority:600,originalText:`SATP heat map ${state} / ${segment} = ${zone}`}));
      }
    });
  }
  return out;
}

function volumeConditions(lo:number|null,hi:number|null):ImportedCondition[]{const c:ImportedCondition[]=[];if(lo!==null)c.push({field:"businessMetrics.monthlyGwp",operator:"GT",value:lo});if(hi!==null)c.push({field:"businessMetrics.monthlyGwp",operator:"LTE",value:hi});return c;}

function payoutRules(fileName:string):ImportedRule[]{
  const out:ImportedRule[]=[];
  const slabs:[number|null,number|null,number][]=[[null,50000,10],[50000,100000,14],[100000,300000,15.5],[300000,600000,17.5],[600000,null,20]];
  for(const product of ["GCV","PCV"]){
    slabs.forEach(([lo,hi,pct],i)=>{
      out.push(pdfRule({fileName,page:2,code:`IFFCO-${product}-COMP-GREEN-S${i+1}`,product,conditions:[{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3","COMP_1_5"]},{field:"insurerContext.iffcoCompZone",operator:"EQUAL",value:"GREEN"},...volumeConditions(lo,hi)],percentage:pct,basis:"GWP",priority:400,originalText:`CVE+CVT Comp Green slab ${lo||0}-${hi||"+"}: ${pct}%`}));
      out.push(pdfRule({fileName,page:2,code:`IFFCO-${product}-SATP-GREEN-S${i+1}`,product,conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"GREEN"},...volumeConditions(lo,hi)],percentage:pct,basis:"GWP",priority:400,originalText:`CVE+CVT SATP Green slab ${lo||0}-${hi||"+"}: ${pct}%`}));
    });
    out.push(pdfStatusRule({fileName,page:2,code:`IFFCO-${product}-COMP-RED-BASEONLY`,product,conditions:[{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3","COMP_1_5"]},{field:"insurerContext.iffcoCompZone",operator:"EQUAL",value:"RED"}],type:"MANUAL_REVIEW",priority:1000,reason:"IFFCO source states 'Base only' for Comprehensive RED heat-map cases; the source does not state the base percentage in this grid."}));
    out.push(pdfRule({fileName,page:2,code:`IFFCO-${product}-SATP-RED`,product,conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"RED"}],percentage:0,basis:"GWP",priority:1000,originalText:"SATP Red = 0%"}));
  }
  // Private car: Comp OD slab; SATP heat map; SAOD fixed 15%.
  out.push(pdfRule({fileName,page:2,code:"IFFCO-PC-COMP-0-20K",product:"PRIVATE_CAR",conditions:[{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3"]},{field:"businessMetrics.monthlyGwp",operator:"LTE",value:20000}],percentage:20,basis:"OD",priority:300,originalText:"PCP 0-20K Comp-OD 20%"}));
  out.push(pdfRule({fileName,page:2,code:"IFFCO-PC-COMP-20KPLUS",product:"PRIVATE_CAR",conditions:[{field:"policyType",operator:"IN",value:["COMP","COMP_1_1","COMP_1_3"]},{field:"businessMetrics.monthlyGwp",operator:"GT",value:20000}],percentage:25,basis:"OD",priority:300,originalText:"PCP 20K and above Comp-OD 25%"}));
  out.push(pdfRule({fileName,page:2,code:"IFFCO-PC-SAOD",product:"PRIVATE_CAR",conditions:[{field:"policyType",operator:"EQUAL",value:"SAOD"}],percentage:15,basis:"OD",priority:300,originalText:"PCP Standalone OD 15%"}));
  out.push(pdfRule({fileName,page:2,code:"IFFCO-PC-SATP-GREEN",product:"PRIVATE_CAR",conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"GREEN"}],percentage:2.5,basis:"TP",priority:500,originalText:"PCP SATP Green 2.5%"}));
  out.push(pdfRule({fileName,page:2,code:"IFFCO-PC-SATP-RED",product:"PRIVATE_CAR",conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"RED"}],percentage:0,basis:"TP",priority:500,originalText:"PCP SATP Red 0%"}));
  // Two-wheeler source gives Base only for all non-red cases and 0% for SATP red.
  out.push(pdfStatusRule({fileName,page:2,code:"IFFCO-TW-SATP-GREEN-BASEONLY",product:"TWO_WHEELER",conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"GREEN"}],type:"MANUAL_REVIEW",reason:"IFFCO source says Base only for Two Wheeler SATP Green; base percentage is not specified in the supplied grid."}));
  out.push(pdfRule({fileName,page:2,code:"IFFCO-TW-SATP-RED",product:"TWO_WHEELER",conditions:[{field:"policyType",operator:"IN",value:["SATP","AOTP","LIABILITY"]},{field:"insurerContext.iffcoSatpZone",operator:"EQUAL",value:"RED"}],percentage:0,basis:"TP",priority:500,originalText:"Two Wheeler SATP Red 0%"}));
  return out;
}

export function parseIffcoPdf(pages:PdfPageText[],context:{fileName:string;version:string}):GridImportResult{
  const joined=pages.map(p=>p.text).join("\n");
  const warnings:string[]=[];
  if(!/SBU Agency Commission Structure|Motor Scheme FY 2026-27/i.test(joined))return{insurerCode:"IFFCO_TOKIO",fileName:context.fileName,rules:[],rtoMappings:[],warnings,errors:["IFFCO_PDF_FORMAT_CHANGED: supplied parser is validated for the FY 26-27 Q1 motor scheme. Review the new document before activation."]};
  const rules=[...compSegmentDerivations(context.fileName),...satpSegmentDerivations(context.fileName),...compHeatmapRules(pages,context.fileName),...satpHeatmapRules(context.fileName),...payoutRules(context.fileName)];
  if(!rules.some(r=>r.ruleKind==="DERIVATION"&&r.result.setField==="insurerContext.iffcoCompZone"))warnings.push("IFFCO Comprehensive heat map text was not extracted. Comprehensive CV results may require review; deploy with poppler/pdftotext.");
  warnings.push("IFFCO SATP page-9 heat-map values are template-locked to the supplied FY 26-27 Q1 grid and source-traced as PDF Page 9. A changed IFFCO template must be revalidated before activation.");
  return{insurerCode:"IFFCO_TOKIO",fileName:context.fileName,rules,rtoMappings:[],warnings,errors:[]};
}
