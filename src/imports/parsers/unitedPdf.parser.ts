import { GridImportResult, ImportedCondition, ImportedRule } from "../types";
import { PdfPageText } from "../pdfReader";
import { pdfRule, stateConditions, stateOtherThan } from "./pdfHelpers";

const S_TW_LOW=["TAMIL NADU","PONDICHERRY","KERALA","KARNATAKA","MADHYA PRADESH","ASSAM"];
const S_PC_LOW=["KARNATAKA","HARYANA","MADHYA PRADESH","TAMIL NADU","PONDICHERRY"];
const S_PC_GT2000=["KARNATAKA","HARYANA","MADHYA PRADESH","CHHATTISGARH","RAJASTHAN","TAMIL NADU","PONDICHERRY","UTTAR PRADESH"];
const S_GCV_GROUP=["HARYANA","MADHYA PRADESH","RAJASTHAN","TAMIL NADU","PONDICHERRY","UTTAR PRADESH","KARNATAKA","KERALA"];

function pct(fileName:string,page:number,code:string,product:string,conditions:ImportedCondition[],percentage:number,basis:"NET"|"OD"|"TP"="NET",priority=300,originalText=""){return pdfRule({fileName,page,code,product,conditions,percentage,basis,priority,originalText});}
function statePair(fileName:string,page:number,code:string,product:string,base:ImportedCondition[],states:string[],inPct:number,outPct:number,basis:"NET"|"OD"|"TP"="NET"):ImportedRule[]{return[
  pct(fileName,page,`${code}-IN`,product,[...base,...stateConditions(states)],inPct,basis,350),
  pct(fileName,page,`${code}-OTHER`,product,[...base,...stateOtherThan(states)],outPct,basis,300)
];}
function cc(lo:number|null,hi:number|null):ImportedCondition[]{const c:ImportedCondition[]=[];if(lo!==null)c.push({field:"cc",operator:"GT",value:lo});if(hi!==null)c.push({field:"cc",operator:"LTE",value:hi});return c;}
function gvw(lo:number|null,hi:number|null):ImportedCondition[]{const c:ImportedCondition[]=[];if(lo!==null)c.push({field:"gvw",operator:"GT",value:lo});if(hi!==null)c.push({field:"gvw",operator:"LTE",value:hi});return c;}
function cover(types:string[]):ImportedCondition[]{return[{field:"policyType",operator:"IN",value:types}];}

function privateCar(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];
  const bundled=[...cover(["COMP_1_3"]),{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"} as ImportedCondition];
  r.push(pct(fileName,6,"UNITED-PC-BUNDLED-LE1000","PRIVATE_CAR",[...bundled,...cc(null,1000)],20));
  r.push(...statePair(fileName,6,"UNITED-PC-BUNDLED-1000-1200","PRIVATE_CAR",[...bundled,...cc(1000,1200)],S_PC_LOW,20,40));
  r.push(pct(fileName,6,"UNITED-PC-BUNDLED-1200-1500","PRIVATE_CAR",[...bundled,...cc(1200,1500)],20));
  r.push(pct(fileName,6,"UNITED-PC-BUNDLED-1500-2000","PRIVATE_CAR",[...bundled,...cc(1500,2000)],40));
  r.push(...statePair(fileName,6,"UNITED-PC-BUNDLED-GT2000","PRIVATE_CAR",[...bundled,...cc(2000,null)],S_PC_GT2000,15,30));

  const regular=[...cover(["COMP","COMP_3_3","SATP","LIABILITY"]),{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"} as ImportedCondition];
  r.push(pct(fileName,6,"UNITED-PC-REG-LE1000","PRIVATE_CAR",[...regular,...cc(null,1000)],20));
  r.push(...statePair(fileName,6,"UNITED-PC-REG-1000-1200","PRIVATE_CAR",[...regular,...cc(1000,1200)],S_PC_LOW,20,35));
  r.push(pct(fileName,6,"UNITED-PC-REG-1200-1500","PRIVATE_CAR",[...regular,...cc(1200,1500)],20));
  r.push(pct(fileName,6,"UNITED-PC-REG-1500-2000","PRIVATE_CAR",[...regular,...cc(1500,2000)],35));
  r.push(...statePair(fileName,6,"UNITED-PC-REG-GT2000","PRIVATE_CAR",[...regular,...cc(2000,null)],S_PC_GT2000,15,30));
  r.push(pct(fileName,6,"UNITED-PC-SAOD","PRIVATE_CAR",[{field:"policyType",operator:"EQUAL",value:"SAOD"},{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"}],15));
  r.push(pct(fileName,6,"UNITED-PC-EV","PRIVATE_CAR",[{field:"fuelType",operator:"EQUAL",value:"ELECTRIC"}],35));
  return r;}

function twoWheeler(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];const regular=cover(["COMP","COMP_1_5","SATP","LIABILITY"]);
  r.push(...statePair(fileName,2,"UNITED-TW-LE150","TWO_WHEELER",[...regular,{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"},...cc(null,150)],S_TW_LOW,5,27.5));
  r.push(...statePair(fileName,2,"UNITED-TW-150-350","TWO_WHEELER",[...regular,{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"},...cc(150,350)],S_TW_LOW,5,22.5));
  r.push(...statePair(fileName,2,"UNITED-TW-GT350","TWO_WHEELER",[...regular,{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"},...cc(350,null)],S_TW_LOW,5,17.5));
  r.push(...statePair(fileName,2,"UNITED-TW-EV","TWO_WHEELER",[...regular,{field:"fuelType",operator:"EQUAL",value:"ELECTRIC"}],S_TW_LOW,5,22.5));
  r.push(pct(fileName,2,"UNITED-TW-SAOD","TWO_WHEELER",[{field:"policyType",operator:"EQUAL",value:"SAOD"}],20));
  return r;}

function pcv(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];const pack=cover(["COMP","COMP_1_1","COMP_1_3","SATP","LIABILITY"]);
  r.push(...statePair(fileName,3,"UNITED-PCV-LE10","PCV",[...pack,{field:"seatingCapacity",operator:"LTE",value:10}], ["HARYANA","RAJASTHAN"],7.5,30));
  r.push(...statePair(fileName,3,"UNITED-PCV-10-20","PCV",[...pack,{field:"seatingCapacity",operator:"GT",value:10},{field:"seatingCapacity",operator:"LTE",value:20}], ["TAMIL NADU","PONDICHERRY","KARNATAKA"],7.5,30));
  r.push(...statePair(fileName,3,"UNITED-PCV-20-30","PCV",[...pack,{field:"seatingCapacity",operator:"GT",value:20},{field:"seatingCapacity",operator:"LTE",value:30},{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"}], ["TAMIL NADU","PONDICHERRY","MADHYA PRADESH","UTTAR PRADESH"],5,10));
  r.push(pdfRule({fileName,page:3,code:"UNITED-PCV-GT30",product:"PCV",conditions:[...pack,{field:"seatingCapacity",operator:"GT",value:30},{field:"fuelType",operator:"NOT_EQUAL",value:"ELECTRIC"}],components:[{basis:"OD",percentage:10},{basis:"TP",percentage:0}],priority:300,originalText:"PCC>30 Except EV: OD 10%, TP 0%"}));
  r.push(pct(fileName,3,"UNITED-PCV-EV-GT20","PCV",[{field:"fuelType",operator:"EQUAL",value:"ELECTRIC"},{field:"seatingCapacity",operator:"GT",value:20}],10));
  r.push(pct(fileName,3,"UNITED-PCV-2W","PCV",[{field:"vehicleType",operator:"IN",value:["2W","TWO_WHEELER"]}],10));
  r.push(...statePair(fileName,3,"UNITED-PCV-3W","PCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"}], ["WEST BENGAL","MAHARASHTRA","GUJARAT","DELHI","UTTARAKHAND","PUNJAB","GOA","JAMMU & KASHMIR"],60,40));
  r.push(pct(fileName,3,"UNITED-PCV-3W-MP","PCV",[{field:"vehicleType",operator:"EQUAL",value:"3W"},{field:"rtoState",operator:"EQUAL",value:"MADHYA PRADESH"}],25,"NET",600));
  r.push(pct(fileName,3,"UNITED-PCV-SCHOOL-STAFF","PCV",[{field:"vehicleUse",operator:"IN",value:["SCHOOL","STAFF"]}],62.5,"NET",700));
  const taxiLow=["HARYANA","KARNATAKA","RAJASTHAN","TAMIL NADU","PONDICHERRY","UTTAR PRADESH","MADHYA PRADESH"];
  r.push(...statePair(fileName,3,"UNITED-PCV-TAXI-COMP","PCV",[{field:"vehicleUse",operator:"EQUAL",value:"TAXI"},...cover(["COMP","COMP_1_1","COMP_1_3"])],taxiLow,15,25));
  r.push(...statePair(fileName,3,"UNITED-PCV-TAXI-SATP","PCV",[{field:"vehicleUse",operator:"EQUAL",value:"TAXI"},...cover(["SATP","LIABILITY"])],taxiLow,15,30));
  return r;}

function gcv(fileName:string, preferredRtos:string[]):ImportedRule[]{const r:ImportedRule[]=[];const comp=cover(["COMP","COMP_1_1","COMP_1_3"]);
  r.push(pct(fileName,4,"UNITED-GCV-LE2000-UP","GCV",[...comp,...gvw(null,2000),{field:"rtoState",operator:"EQUAL",value:"UTTAR PRADESH"}],50));
  r.push(pct(fileName,4,"UNITED-GCV-LE2000-OTHER","GCV",[...comp,...gvw(null,2000),{field:"rtoState",operator:"NOT_EQUAL",value:"UTTAR PRADESH"}],60));
  r.push(pct(fileName,7,"UNITED-GCV-2000-3500-RJ-PREFERRED","GCV",[...comp,...gvw(2000,3500),{field:"rtoCode",operator:"IN",value:preferredRtos}],56.5,"NET",1000));
  r.push(pct(fileName,4,"UNITED-GCV-2000-3500-LOW","GCV",[...comp,...gvw(2000,3500),...stateConditions(["MADHYA PRADESH","TAMIL NADU","UTTAR PRADESH","HARYANA"])],15));
  r.push(pct(fileName,4,"UNITED-GCV-2000-3500-RJ","GCV",[...comp,...gvw(2000,3500),{field:"rtoState",operator:"EQUAL",value:"RAJASTHAN"},{field:"rtoCode",operator:"NOT_IN",value:preferredRtos}],35));
  r.push(pct(fileName,4,"UNITED-GCV-2000-3500-KLKA","GCV",[...comp,...gvw(2000,3500),...stateConditions(["KERALA","KARNATAKA"])],45));
  r.push(pct(fileName,4,"UNITED-GCV-2000-3500-OTHER","GCV",[...comp,...gvw(2000,3500),...stateOtherThan(["MADHYA PRADESH","TAMIL NADU","UTTAR PRADESH","HARYANA","RAJASTHAN","KERALA","KARNATAKA"])],56.5));
  r.push(...statePair(fileName,4,"UNITED-GCV-3500-7500","GCV",[...comp,...gvw(3500,7500)],["HARYANA","MADHYA PRADESH","RAJASTHAN","TAMIL NADU","PONDICHERRY","UTTAR PRADESH"],10,27.5));
  r.push(pct(fileName,4,"UNITED-GCV-7500-10000-TNPY","GCV",[...comp,...gvw(7500,10000),...stateConditions(["TAMIL NADU","PONDICHERRY"])],5));
  r.push(pct(fileName,4,"UNITED-GCV-7500-10000-RJ","GCV",[...comp,...gvw(7500,10000),{field:"rtoState",operator:"EQUAL",value:"RAJASTHAN"}],15));
  r.push(pct(fileName,4,"UNITED-GCV-7500-10000-OTHER","GCV",[...comp,...gvw(7500,10000),...stateOtherThan(["TAMIL NADU","PONDICHERRY","RAJASTHAN"])],22.5));
  r.push(pct(fileName,4,"UNITED-GCV-10000-12000","GCV",[...comp,...gvw(10000,12000)],2.5));
  r.push(...statePair(fileName,4,"UNITED-GCV-12000-20000","GCV",[...comp,...gvw(12000,20000)],S_GCV_GROUP,5,15));
  r.push(...statePair(fileName,5,"UNITED-GCV-20000-25000","GCV",[...comp,...gvw(20000,25000)],S_GCV_GROUP,5,15));
  r.push(...statePair(fileName,5,"UNITED-GCV-25000-32000","GCV",[...comp,...gvw(25000,32000)],S_GCV_GROUP,2.5,12.5));
  r.push(pct(fileName,5,"UNITED-GCV-32000-40000","GCV",[...comp,...gvw(32000,40000)],5));
  r.push(...statePair(fileName,5,"UNITED-GCV-GT40000","GCV",[...comp,...gvw(40000,null)],S_GCV_GROUP,0,2.5));
  r.push(pct(fileName,5,"UNITED-GCV-ECART","GCV",[{field:"vehicleType",operator:"EQUAL",value:"E_CART"}],50));
  return r;}

function extractRtos(pageText:string):string[]{return [...pageText.matchAll(/\b([A-Z]{2})\s*-?\s*(\d{1,2})\b/g)].map(m=>`${m[1]}-${m[2].padStart(2,"0")}`);}

export function parseUnitedPdf(pages:PdfPageText[],context:{fileName:string;version:string}):GridImportResult{
  const joined=pages.map(p=>p.text).join("\n");const warnings:string[]=[];
  if(!/UNITED INDIA INSURANCE|UNIED INDIA INSURANCE/i.test(joined)||!/01\.08\.2026|01-08-2026/i.test(joined))return{insurerCode:"UNITED_INDIA",fileName:context.fileName,rules:[],rtoMappings:[],warnings,errors:["UNITED_PDF_FORMAT_CHANGED: expected Aug-2026 commission circular markers were not found. Review before activation."]};
  const p7=pages.find(p=>/Preferred RTOs for GCV Segment/i.test(p.text));const preferredGcv=p7?extractRtos(p7.text):[];
  const p8=pages.find(p=>/Preferred RTOs of Identified Cities/i.test(p.text));const preferredPc=p8?extractRtos(p8.text):[];
  const rules=[...privateCar(context.fileName),...twoWheeler(context.fileName),...pcv(context.fileName),...gcv(context.fileName,preferredGcv)];
  const prefBase:ImportedCondition[]=[{field:"rtoCode",operator:"IN",value:preferredPc}];
  if(preferredPc.length){
    rules.push(pct(context.fileName,8,"UNITED-PC-PREFERRED-RTO-NONDIESEL","PRIVATE_CAR",[...prefBase,{field:"fuelType",operator:"NOT_EQUAL",value:"DIESEL"}],40,"NET",2000,"Preferred city RTO override = 40%"));
    rules.push(pct(context.fileName,8,"UNITED-PC-PREFERRED-RTO-DIESEL-GT1500","PRIVATE_CAR",[...prefBase,{field:"fuelType",operator:"EQUAL",value:"DIESEL"},{field:"cc",operator:"GT",value:1500}],40,"NET",2000,"Preferred city RTO override = 40%, except diesel <=1500cc"));
    // Kerala: all RTOs except KL15 are preferred according to source.
    rules.push(pct(context.fileName,8,"UNITED-PC-PREFERRED-KERALA-NONDIESEL","PRIVATE_CAR",[{field:"rtoState",operator:"EQUAL",value:"KERALA"},{field:"rtoCode",operator:"NOT_EQUAL",value:"KL-15"},{field:"fuelType",operator:"NOT_EQUAL",value:"DIESEL"}],40,"NET",2000));
    rules.push(pct(context.fileName,8,"UNITED-PC-PREFERRED-KERALA-DIESEL-GT1500","PRIVATE_CAR",[{field:"rtoState",operator:"EQUAL",value:"KERALA"},{field:"rtoCode",operator:"NOT_EQUAL",value:"KL-15"},{field:"fuelType",operator:"EQUAL",value:"DIESEL"},{field:"cc",operator:"GT",value:1500}],40,"NET",2000));
  } else warnings.push("United preferred Private Car RTO annexure could not be extracted; 40% city override is not executable.");
  if(!preferredGcv.length)warnings.push("United preferred Rajasthan GCV RTO annexure could not be extracted; 56.5% RTO override is not executable.");
  warnings.push("United rules are state-driven from RTO prefix; user does not need to enter State separately. Specific preferred-RTO overrides are higher priority.");
  return{insurerCode:"UNITED_INDIA",fileName:context.fileName,rules,rtoMappings:[],warnings,errors:[]};
}
