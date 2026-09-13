import { GridImportResult, ImportedCondition, ImportedRule } from "../types";
import { PdfPageText } from "../pdfReader";
import { pdfRule } from "./pdfHelpers";

function age(lo:number|null,hi:number|null,newOnly=false):ImportedCondition[]{if(newOnly)return[{field:"vehicleAge",operator:"EQUAL",value:0}];const c:ImportedCondition[]=[];if(lo!==null)c.push({field:"vehicleAge",operator:"GT",value:lo});if(hi!==null)c.push({field:"vehicleAge",operator:"LTE",value:hi});return c;}
function gvw(lo:number|null,hi:number|null):ImportedCondition[]{const c:ImportedCondition[]=[];if(lo!==null)c.push({field:"gvw",operator:"GT",value:lo});if(hi!==null)c.push({field:"gvw",operator:"LTE",value:hi});return c;}
function composite(fileName:string,page:number,code:string,product:string,conditions:ImportedCondition[],od:number,tp:number,priority=300,originalText=""):ImportedRule{return pdfRule({fileName,page,code,product,conditions,components:[{basis:"OD",percentage:od},{basis:"TP",percentage:tp}],priority,originalText:originalText||`Commission OD ${od}%, TP ${tp}%`});}
function tpOnly(fileName:string,page:number,code:string,product:string,conditions:ImportedCondition[],tp:number,priority=300){return pdfRule({fileName,page,code,product,conditions,percentage:tp,basis:"TP",priority,originalText:`Commission TP ${tp}%`});}
function odOnly(fileName:string,page:number,code:string,product:string,conditions:ImportedCondition[],od:number,priority=300){return pdfRule({fileName,page,code,product,conditions,percentage:od,basis:"OD",priority,originalText:`Commission OD ${od}%`});}
function cover(vals:string[]):ImportedCondition[]{return[{field:"policyType",operator:"IN",value:vals}];}

function tw(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];
  r.push(composite(fileName,4,"NAT-TW-BUNDLE-NEW","TWO_WHEELER",[...cover(["COMP_1_5"]),...age(null,null,true)],27.5,30));
  r.push(composite(fileName,4,"NAT-TW-BUNDLE-2ND","TWO_WHEELER",[...cover(["COMP_1_5"]),{field:"vehicleAge",operator:"GT",value:0}],0,15));
  r.push(odOnly(fileName,4,"NAT-TW-SAOD-LE10","TWO_WHEELER",[...cover(["SAOD"]),...age(null,10)],25));
  r.push(odOnly(fileName,4,"NAT-TW-SAOD-GT10","TWO_WHEELER",[...cover(["SAOD"]),...age(10,null)],5));
  const compBands: Array<[number|null,number|null,number,number,string]> =[
    [null,5,20,20,"LE5"],[5,10,20,15,"5-10"],[10,15,15,15,"10-15"],[15,null,10,10,"GT15"]
  ];
  for(const [lo,hi,od,tp,label] of compBands)r.push(composite(fileName,4,`NAT-TW-COMP-${label}`,"TWO_WHEELER",[...cover(["COMP"]),...age(lo,hi)],od,tp));
  r.push(composite(fileName,4,"NAT-TW-LT-NEW","TWO_WHEELER",[...cover(["LONG_TERM_PACKAGE","COMP_5_5"]),...age(null,null,true)],30,30));
  r.push(composite(fileName,4,"NAT-TW-LT-2ND","TWO_WHEELER",[...cover(["LONG_TERM_PACKAGE","COMP_5_5"]),{field:"vehicleAge",operator:"GT",value:0}],20,20));
  r.push(composite(fileName,4,"NAT-TW-MCYLT-LE10","TWO_WHEELER",[...cover(["MCYLT"]),...age(null,10)],10,10));
  // Standalone TP / long-term TP pages 8-9
  r.push(tpOnly(fileName,8,"NAT-TW-SATP-LE10","TWO_WHEELER",[...cover(["SATP","LIABILITY"]),...age(null,10)],15));
  r.push(tpOnly(fileName,8,"NAT-TW-SATP-GT10","TWO_WHEELER",[...cover(["SATP","LIABILITY"]),...age(10,null)],10));
  return r;}

function privateCar(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];
  r.push(composite(fileName,5,"NAT-PC-BUNDLE-NEW","PRIVATE_CAR",[...cover(["COMP_1_3"]),...age(null,null,true)],25,25));
  r.push(composite(fileName,5,"NAT-PC-BUNDLE-2ND","PRIVATE_CAR",[...cover(["COMP_1_3"]),{field:"vehicleAge",operator:"GT",value:0}],0,20));
  r.push(odOnly(fileName,5,"NAT-PC-SAOD-LE10","PRIVATE_CAR",[...cover(["SAOD"]),...age(null,10)],20));
  r.push(odOnly(fileName,5,"NAT-PC-SAOD-GT10","PRIVATE_CAR",[...cover(["SAOD"]),...age(10,null)],5));
  const bands: Array<[number|null,number|null,number,number,string]> =[[null,3,20,20,"LE3"],[3,10,20,20,"3-10"],[10,15,15,17.5,"10-15"],[15,null,5,10,"GT15"]];
  for(const [lo,hi,od,tp,label] of bands)r.push(composite(fileName,5,`NAT-PC-COMP-${label}`,"PRIVATE_CAR",[...cover(["COMP"]),...age(lo,hi)],od,tp));
  r.push(composite(fileName,5,"NAT-PC-LT-NEW","PRIVATE_CAR",[...cover(["LONG_TERM_PACKAGE","COMP_3_3"]),...age(null,null,true)],25,30));
  r.push(composite(fileName,5,"NAT-PC-LT-2ND","PRIVATE_CAR",[...cover(["LONG_TERM_PACKAGE","COMP_3_3"]),{field:"vehicleAge",operator:"GT",value:0}],20,20));
  r.push(tpOnly(fileName,9,"NAT-PC-SATP-LE10","PRIVATE_CAR",[...cover(["SATP","LIABILITY"]),...age(null,10)],20));
  r.push(tpOnly(fileName,9,"NAT-PC-SATP-GT10","PRIVATE_CAR",[...cover(["SATP","LIABILITY"]),...age(10,null)],15));
  return r;}

function gcv(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];const comp=cover(["COMP"]);
  const table:Array<[number|null,number|null,Array<[number|null,number|null,number,number,string]>]>=[
    [null,3500,[[null,0,45,45,"NEW"],[0,10,45,45,"0-10"],[10,15,30,30,"10-15"],[15,null,20,20,"GT15"]]],
    [3500,7500,[[null,0,30,30,"NEW"],[0,10,25,25,"0-10"],[10,15,20,20,"10-15"],[15,null,10,10,"GT15"]]],
    [7500,16500,[[null,0,20,20,"NEW"],[0,10,15,15,"0-10"],[10,15,15,15,"10-15"],[15,null,10,10,"GT15"]]],
    [16500,34000,[[null,0,17.5,15,"NEW"],[0,10,15,15,"0-10"],[10,15,10,10,"10-15"],[15,null,10,5,"GT15"]]],
    [34000,40000,[[null,0,15,7.5,"NEW"],[0,10,10,10,"0-10"],[10,15,7.5,5,"10-15"],[15,null,2.5,2.5,"GT15"]]],
    [40000,48000,[[null,0,5,2.5,"NEW"],[0,10,5,2.5,"0-10"],[10,15,2.5,2.5,"10-15"],[15,null,0,2.5,"GT15"]]],
    [48000,null,[[null,0,5,2.5,"NEW"],[0,10,2.5,2.5,"0-10"],[10,15,0,2.5,"10-15"],[15,null,0,2.5,"GT15"]]]
  ];
  table.forEach(([glo,ghi,ages],gi)=>ages.forEach(([alo,ahi,od,tp,label])=>{const ageCond=alo===null&&ahi===0?age(null,null,true):age(alo,ahi);r.push(composite(fileName,gi<6?6:7,`NAT-GCV-G${gi+1}-${label}`,"GCV",[...comp,...gvw(glo,ghi),...ageCond],od,tp));}));
  // Standalone TP page 9.
  const tpBands:Array<[number|null,number|null,number,number]>=[[null,3500,40,30],[3500,7500,25,20],[7500,34000,15,10],[34000,40000,7.5,5],[40000,null,2.5,2.5]];
  tpBands.forEach(([lo,hi,le10,gt10],i)=>{r.push(tpOnly(fileName,9,`NAT-GCV-SATP-B${i+1}-LE10`,"GCV",[...cover(["SATP","LIABILITY"]),...gvw(lo,hi),...age(null,10)],le10));r.push(tpOnly(fileName,9,`NAT-GCV-SATP-B${i+1}-GT10`,"GCV",[...cover(["SATP","LIABILITY"]),...gvw(lo,hi),...age(10,null)],gt10));});
  return r;}

function pcv(fileName:string):ImportedRule[]{const r:ImportedRule[]=[];const comp=cover(["COMP"]);
  // School / educational institutional buses.
  r.push(composite(fileName,5,"NAT-PCV-SCHOOL-NEW","PCV",[...comp,{field:"vehicleUse",operator:"EQUAL",value:"SCHOOL"},...age(null,null,true)],60,60,800));
  r.push(composite(fileName,5,"NAT-PCV-SCHOOL-LE10","PCV",[...comp,{field:"vehicleUse",operator:"EQUAL",value:"SCHOOL"},...age(0,10)],60,60,800));
  r.push(composite(fileName,5,"NAT-PCV-SCHOOL-GT10","PCV",[...comp,{field:"vehicleUse",operator:"EQUAL",value:"SCHOOL"},...age(10,null)],35,35,800));
  const addAgeTable=(prefix:string,base:ImportedCondition[],rows:Array<[number|null,number|null,number,number,string]>)=>rows.forEach(([lo,hi,od,tp,label])=>{const ac=lo===null&&hi===0?age(null,null,true):age(lo,hi);r.push(composite(fileName,7,`${prefix}-${label}`,"PCV",[...comp,...base,...ac],od,tp));});
  addAgeTable("NAT-PCV-3W",[{field:"vehicleType",operator:"EQUAL",value:"3W"}],[[null,0,30,35,"NEW"],[0,5,25,25,"0-5"],[5,10,20,25,"5-10"],[10,15,5,20,"10-15"],[15,null,0,5,"GT15"]]);
  addAgeTable("NAT-PCV-TAXI",[{field:"vehicleType",operator:"NOT_EQUAL",value:"3W"},{field:"seatingCapacity",operator:"LTE",value:6}],[[null,0,20,15,"NEW"],[0,5,20,15,"0-5"],[5,10,17.5,12.5,"5-10"],[10,15,10,10,"10-15"],[15,null,5,5,"GT15"]]);
  addAgeTable("NAT-PCV-7-30",[{field:"seatingCapacity",operator:"GT",value:6},{field:"seatingCapacity",operator:"LTE",value:30}],[[null,0,15,15,"NEW"],[0,5,15,15,"0-5"],[5,10,12.5,12.5,"5-10"],[10,15,7.5,10,"10-15"],[15,null,0,7.5,"GT15"]]);
  addAgeTable("NAT-PCV-GT30",[{field:"seatingCapacity",operator:"GT",value:30}],[[null,5,2.5,2.5,"LE5"],[5,10,2.5,2.5,"5-10"],[10,15,2.5,2.5,"10-15"],[15,null,0,2.5,"GT15"]]);
  addAgeTable("NAT-PCV-2W",[{field:"vehicleType",operator:"IN",value:["2W","TWO_WHEELER"]}],[[null,10,10,5,"LE10"],[10,15,10,5,"10-15"],[15,null,10,5,"GT15"]]);
  // Standalone TP pages 9-10.
  const tp=(code:string,base:ImportedCondition[],le:number,gt:number)=>{r.push(tpOnly(fileName,9,`${code}-LE10`,"PCV",[...cover(["SATP","LIABILITY"]),...base,...age(null,10)],le));r.push(tpOnly(fileName,10,`${code}-GT10`,"PCV",[...cover(["SATP","LIABILITY"]),...base,...age(10,null)],gt));};
  tp("NAT-PCV-SATP-3W",[{field:"vehicleType",operator:"EQUAL",value:"3W"}],10,10);
  tp("NAT-PCV-SATP-TAXI",[{field:"seatingCapacity",operator:"LTE",value:6}],10,7.5);
  tp("NAT-PCV-SATP-7-30",[{field:"seatingCapacity",operator:"GT",value:6},{field:"seatingCapacity",operator:"LTE",value:30}],10,5);
  tp("NAT-PCV-SATP-GT30",[{field:"seatingCapacity",operator:"GT",value:30}],2.5,2.5);
  tp("NAT-PCV-SATP-2W",[{field:"vehicleType",operator:"IN",value:["2W","TWO_WHEELER"]}],5,5);
  return r;}

export function parseNationalPdf(pages:PdfPageText[],context:{fileName:string;version:string}):GridImportResult{
  const joined=pages.map(p=>p.text).join("\n");const warnings:string[]=[];
  if(!/National Insurance/i.test(joined)||!/2026-27/i.test(joined))return{insurerCode:"NATIONAL_INSURANCE",fileName:context.fileName,rules:[],rtoMappings:[],warnings,errors:["NATIONAL_OCR_REQUIRED_OR_FORMAT_CHANGED: National grid is scanned. OCR must be enabled and the FY 2026-27 motor pages must be detected before activation."]};
  const rules=[...tw(context.fileName),...privateCar(context.fileName),...gcv(context.fileName),...pcv(context.fileName)];
  warnings.push("National Insurance parser is state/RTO independent for the motor rules implemented from pages 4-10. The source has separate OD and TP commission columns; V7 preserves them as composite payout components instead of collapsing them into one guessed percentage.");
  warnings.push("National PDF is scanned; V7 uses OCR only because vector text is absent. Always spot-check the normalized OD/TP components against source pages before activation.");
  return{insurerCode:"NATIONAL_INSURANCE",fileName:context.fileName,rules,rtoMappings:[],warnings,errors:[]};
}
