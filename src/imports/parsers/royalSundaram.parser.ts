import { ExcelSheet } from "../excelReader";
import { GridImportResult, ImportedCondition, ImportedRtoMapping, ImportedRule } from "../types";
import { clean, excelColumn, makePayoutRule, normalizePolicyType, normalizeRto, pct, rangeConditions, rule, upper } from "./helpers";

const stateAlias = (v: unknown) => {
  const s = upper(v)
    .replace(/TELENGANA/g, "TELANGANA")
    .replace(/ORISSA/g, "ODISHA")
    .replace(/CHATTISGARH/g, "CHHATTISGARH")
    .replace(/UTTARANCHAL/g, "UTTARAKHAND")
    .replace(/JAMMU AND KASHMIR/g, "JAMMU & KASHMIR")
    .replace(/ANDAMAN NICOBAR/g, "ANDAMAN & NICOBAR")
    .trim();
  const short: Record<string,string> = { AP:"ANDHRA PRADESH", TS:"TELANGANA", TN:"TAMIL NADU", MH:"MAHARASHTRA", GJ:"GUJARAT", KA:"KARNATAKA", KL:"KERALA", MP:"MADHYA PRADESH", RJ:"RAJASTHAN", WB:"WEST BENGAL" };
  return short[s] || s;
};

function numeric(v: unknown) { return pct(v); }
function payout(file:string,sheet:string,row:number,code:string,product:string,conditions:ImportedCondition[],value:unknown,basis:"NET"|"TP"|"OD"|"GWP"="NET",priority=100,column?:string,kind:"BASE"|"ADJUSTMENT"|"OVERRIDE"="BASE") {
  const p=numeric(value); if(p===null) return null;
  return makePayoutRule(file,sheet,row,code,product,conditions,p,basis,priority,column,clean(value),kind);
}
function compositeRule(file:string,sheet:string,row:number,code:string,product:string,conditions:ImportedCondition[],value:unknown,priority=110,column?:string): ImportedRule | null {
  const t=clean(value); if(!t) return null;
  const od=t.match(/([\d.]+)%?\s*ON\s*OD/i); const tp=t.match(/([\d.]+)%?\s*ON\s*TP/i);
  if(!od||!tp) return null;
  return {ruleCode:code,product,priority,ruleKind:"BASE",conditions,result:{type:"PAYOUT",components:[{basis:"OD",percentage:Number(od[1])},{basis:"TP",percentage:Number(tp[1])}]},source:{fileName:file,sheet,row,column,originalText:t}};
}
function geoConditions(state:unknown, location?:unknown): ImportedCondition[] {
  const c:ImportedCondition[]=[]; const st=stateAlias(state), loc=upper(location);
  if(st) c.push({field:"rtoState",operator:"EQUAL",value:st});
  if(loc && !/^REST OF|^OTHER|^ALL GEO|^PAN INDIA/.test(loc)) c.push({field:"rtoCluster",operator:"EQUAL",value:loc});
  return c;
}
function ccConditions(v:unknown):ImportedCondition[]{ const s=upper(v).replace(/CC/g,"").replace(/UPTO/g,"<=").replace(/ABOVE/g,">"); return rangeConditions("cc",s); }
function gvwBand(text:string):ImportedCondition[]{ return rangeConditions("gvw", text.replace(/A\.|B\.|C\.|D\.|E\.|F\.|G\.|H\.|I\./g,"").replace(/TONS?/gi," T")); }
function makeGroupConditions(text:string):ImportedCondition[]{
  const u=upper(text); if(u.includes("TATA")&&u.includes("ASHOK")) return [{field:"make",operator:"IN",value:["TATA","TATA MOTORS","ASHOK LEYLAND"]}];
  if(u.includes("OTHER")) return [{field:"make",operator:"NOT_IN",value:["TATA","TATA MOTORS","ASHOK LEYLAND","EICHER"]}];
  return [];
}

function parseGcvComp(sheets:ExcelSheet[],ctx:any,rules:ImportedRule[]){
  for(const sh of sheets.filter(s=>/^GCV COMP 4W/i.test(s.name))){
    const stateRow=sh.rows[1]||[]; const locRow=sh.rows[2]||[];
    for(let i=3;i<Math.min(sh.rows.length,13);i++){
      const row=sh.rows[i]||[]; const band=clean(row[0]); if(!band) continue;
      for(let col=1;col<row.length;col++){
        const p=numeric(row[col]); if(p===null) continue;
        const loc=clean(locRow[col]); if(!loc) continue; const st=clean(stateRow[col]);
        const common:ImportedCondition[]=[...geoConditions(st,loc),...gvwBand(band),{field:"policyType",operator:"EQUAL",value:"COMP"}];
        // Source notes define Tata/Ashok as baseline, Eicher -3%, all other makes -5%.
        for(const variant of [
          {suffix:"TA",cond:{field:"make",operator:"IN",value:["TATA","TATA MOTORS","ASHOK LEYLAND"]} as ImportedCondition,delta:0},
          {suffix:"EICHER",cond:{field:"make",operator:"EQUAL",value:"EICHER"} as ImportedCondition,delta:-3},
          {suffix:"OTHER",cond:{field:"make",operator:"NOT_IN",value:["TATA","TATA MOTORS","ASHOK LEYLAND","EICHER"]} as ImportedCondition,delta:-5}
        ]){
          // Old vehicle source grid.
          rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV-${i+1}-${col+1}-${variant.suffix}-OLD`,'GCV',[...common,variant.cond,{field:"vehicleAge",operator:"GT",value:0}],Math.max(0,p+variant.delta),'NET',230,excelColumn(col),clean(row[col])));
          // Source note: new vehicle payout is 3% lower only when current payout >=10, else same.
          const newBase=p>=10?p-3:p;
          rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV-${i+1}-${col+1}-${variant.suffix}-NEW`,'GCV',[...common,variant.cond,{field:"vehicleAge",operator:"EQUAL",value:0}],Math.max(0,newBase+variant.delta),'NET',240,excelColumn(col),`${clean(row[col])}; source note new vehicle ${p>=10?"-3pp":"same"}`));
        }
        // Tata/Ashok source note: +2pp when OD discount <85.
        rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV-${i+1}-${col+1}-TA-ODDISC`,'GCV',[...common,{field:"make",operator:"IN",value:["TATA","TATA MOTORS","ASHOK LEYLAND"]},{field:"odDiscountPercent",operator:"LT",value:85}],2,'NET',400,excelColumn(col),"Source note: additional 2% where discount <85%",'ADJUSTMENT'));
        rules[rules.length-1].ruleGroup='ROY_GCV_OD_DISCOUNT';
      }
    }
  }
}

function parseSchoolBus(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){ if(!sh)return; for(let i=3;i<sh.rows.length;i++){const r=sh.rows[i]||[];const state=clean(r[5]??r[1]); const p=numeric(r[6]??r[3]);if(!state||p===null)continue;rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-SCHOOL-${i+1}`,'PCV',[{field:'rtoState',operator:'EQUAL',value:stateAlias(state)},{field:'vehicleUse',operator:'EQUAL',value:'SCHOOL'}],p,'TP',220,excelColumn(r[6]!=null?6:3),clean(r[6]??r[3])));}}
function parseTractor(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=2;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[0]);if(!st)continue;const base:ImportedCondition[]=[{field:'rtoState',operator:'EQUAL',value:stateAlias(st)},{field:'vehicleType',operator:'EQUAL',value:'TRACTOR'}];const remark=upper(r[4]);if(remark.includes('NEW'))base.push({field:'vehicleAge',operator:'EQUAL',value:0});else if(remark.includes('ROLL')||remark.includes('RENEW'))base.push({field:'vehicleAge',operator:'GT',value:0});for(const [col,pt,basis] of [[2,'COMP','NET'],[3,'SATP','TP']] as const){const rr=rule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-TRACTOR-${i+1}-${pt}`,'GCV',[...base,{field:'policyType',operator:'EQUAL',value:pt}],r[col],basis,180,excelColumn(col));if(rr)rules.push(rr);}}}
function parseTaxi(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[2]);if(!st)continue;for(const [col,lo,hi] of [[3,4,6],[4,7,10]] as const){const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-TAXI-${i+1}-${col}`,'PCV',[{field:'rtoState',operator:'EQUAL',value:stateAlias(st)},{field:'vehicleUse',operator:'EQUAL',value:'TAXI'},{field:'vehicleAge',operator:'GT',value:0},{field:'seatingCapacity',operator:'BETWEEN',value:[lo,hi]},{field:'policyType',operator:'EQUAL',value:'COMP'}],r[col],'NET',180,excelColumn(col));if(rr)rules.push(rr);}}}
function parse2wComp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;let state='';for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];if(clean(r[0]))state=clean(r[0]);const loc=clean(r[1]);if(!loc)continue;const base:ImportedCondition[]=[...geoConditions(state,loc),{field:'policyType',operator:'EQUAL',value:'COMP_1_1'}];const sc=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-2W-SC-${i+1}`,'TWO_WHEELER',[...base,{field:'vehicleType',operator:'IN',value:['SCOOTER','MOPED']}],r[2],'NET',190,'C');if(sc)rules.push(sc);const mc=compositeRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-2W-MC-${i+1}`,'TWO_WHEELER',[...base,{field:'vehicleType',operator:'EQUAL',value:'MOTOR_CYCLE'},{field:'cc',operator:'LTE',value:150}],r[3],200,'D');if(mc)rules.push(mc);else{const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-2W-MC-${i+1}`,'TWO_WHEELER',[...base,{field:'vehicleType',operator:'EQUAL',value:'MOTOR_CYCLE'},{field:'cc',operator:'LTE',value:150}],r[3],'NET',190,'D');if(rr)rules.push(rr);}}}
function parse2wStp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[1]),loc=clean(r[2]);if(!st||!loc)continue;for(const [col,vt] of [[3,'MOTOR_CYCLE'],[4,'SCOOTER']] as const){const c:ImportedCondition[]=[...geoConditions(st,loc),{field:'policyType',operator:'EQUAL',value:'SATP'},{field:'vehicleType',operator:'EQUAL',value:vt}];if(vt==='MOTOR_CYCLE')c.push({field:'cc',operator:'LT',value:150});const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-2W-STP-${i+1}-${vt}`,'TWO_WHEELER',c,r[col],'TP',190,excelColumn(col));if(rr)rules.push(rr);}}}
function parse3wPcvComp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];for(const offset of [0,6]){const st=clean(r[offset+1]),loc=clean(r[offset+2]);if(!st||!loc)continue;const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-3W-PCV-${i+1}-${offset}`,'PCV',[...geoConditions(st,loc),{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'seatingCapacity',operator:'LTE',value:3},{field:'vehicleAge',operator:'BETWEEN',value:[0,3]},{field:'policyType',operator:'EQUAL',value:'COMP'}],r[offset+3],'NET',200,excelColumn(offset+3));if(rr)rules.push(rr);}}}
function parsePcvStp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[1]),loc=clean(r[4]);if(!st||!loc)continue;const base=[...geoConditions(st,loc),{field:'policyType',operator:'EQUAL',value:'SATP'}] as ImportedCondition[];const specs=[
  {col:5,c:[{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'seatingCapacity',operator:'LTE',value:3}]},
  {col:6,c:[{field:'seatingCapacity',operator:'BETWEEN',value:[4,6]},{field:'make',operator:'IN',value:['MARUTI','MARUTI SUZUKI']}]},
  {col:7,c:[{field:'seatingCapacity',operator:'BETWEEN',value:[4,6]},{field:'make',operator:'NOT_IN',value:['MARUTI','MARUTI SUZUKI']}]},
  {col:8,c:[{field:'seatingCapacity',operator:'BETWEEN',value:[7,10]}]},
  {col:9,c:[{field:'seatingCapacity',operator:'BETWEEN',value:[11,18]}]},
  {col:10,c:[{field:'seatingCapacity',operator:'GT',value:18},{field:'vehicleUse',operator:'IN',value:['INSTITUTION','CORPORATE','STAFF']}]},
  {col:11,c:[{field:'vehicleUse',operator:'EQUAL',value:'SCHOOL'}]},
  {col:12,c:[{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'seatingCapacity',operator:'GT',value:3}]}
  ];for(const sp of specs){const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-PCV-STP-${i+1}-${sp.col}`,'PCV',[...base,...(sp.c as ImportedCondition[])],r[sp.col],'TP',190,excelColumn(sp.col));if(rr)rules.push(rr);}}
}
function parse3wEvComp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;const r=sh.rows[6]||[];const variants=[{col:2,c:[{field:'rtoState',operator:'NOT_IN',value:['DELHI','TAMIL NADU']}]},{col:7,c:[{field:'rtoState',operator:'EQUAL',value:'DELHI'}]},{col:12,c:[{field:'rtoState',operator:'EQUAL',value:'TAMIL NADU'}]}];for(const v of variants){const rr=payout(ctx.fileName,sh.name,7,`ROY-${ctx.version}-3W-EV-${v.col}`,'PCV',[...(v.c as ImportedCondition[]),{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'fuelType',operator:'EQUAL',value:'ELECTRIC'},{field:'policyType',operator:'EQUAL',value:'COMP'}],r[v.col],'NET',220,excelColumn(v.col));if(rr)rules.push(rr);}}
function parseEvStp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=3;i<sh.rows.length;i++){const r=sh.rows[i]||[];const prod=upper(r[1]),p=r[2];let product='';const c:ImportedCondition[]=[{field:'fuelType',operator:'EQUAL',value:'ELECTRIC'},{field:'policyType',operator:'EQUAL',value:'SATP'}];if(prod.includes('GOODS')){product='GCV';}else if(prod.includes('PCV')&&prod.includes('3')){product='PCV';c.push({field:'vehicleType',operator:'EQUAL',value:'3W'});}else if(prod.includes('PCV')){product='PCV';c.push({field:'vehicleType',operator:'NOT_EQUAL',value:'3W'});}else if(prod.includes('TWO'))product='TWO_WHEELER';if(!product)continue;const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-EV-STP-${i+1}`,product,c,p,'TP',200,'C');if(rr)rules.push(rr);}}
function parseGcv4wStp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;const bands=['0 to 2.3','2.3 to 3.5','3.5 and 7.5','7.5 and 12','12 and 20','20 and 40','40 and 45','45 to 48','Above 48'];for(let i=2;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[0]),loc=clean(r[1]);if(!st||!loc)continue;for(let j=0;j<bands.length;j++){const c:ImportedCondition[]=[...geoConditions(st,loc),...rangeConditions('gvw',bands[j].includes('Above')?bands[j].replace('Above','>'):bands[j]),{field:'vehicleType',operator:'NOT_EQUAL',value:'3W'},{field:'fuelType',operator:'NOT_EQUAL',value:'ELECTRIC'},{field:'policyType',operator:'EQUAL',value:'SATP'}];const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV4-STP-${i+1}-${j}`,'GCV',c,r[j+2],'TP',190,excelColumn(j+2));if(rr)rules.push(rr);}}}
function parseGcv3w(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[],electric:boolean){if(!sh)return;for(let i=2;i<sh.rows.length;i++){const r=sh.rows[i]||[];for(const offset of [0,4]){const st=clean(r[offset]),loc=clean(r[offset+1]);if(!st||!loc)continue;const pt=offset===0?'SATP':'COMP';const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV3-${electric?'EV':'NON'}-${pt}-${i+1}`,'GCV',[...geoConditions(st,loc),{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'fuelType',operator:electric?'EQUAL':'NOT_EQUAL',value:'ELECTRIC'},{field:'policyType',operator:'EQUAL',value:pt}],r[offset+2],pt==='SATP'?'TP':'NET',200,excelColumn(offset+2));if(rr)rules.push(rr);}}}
function parseGcv4wEv(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=2;i<sh.rows.length;i++){const r=sh.rows[i]||[];for(const offset of [0,6]){const st=clean(r[offset]);if(!st)continue;const pt=offset===0?'SATP':'COMP';const type=upper(r[offset+3]);if(type&&((pt==='SATP'&&!type.includes('ACT'))||(pt==='COMP'&&!type.includes('PACKAGE'))))continue;const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-GCV4-EV-${pt}-${i+1}`,'GCV',[{field:'rtoState',operator:'EQUAL',value:stateAlias(st)},{field:'vehicleType',operator:'NOT_EQUAL',value:'3W'},{field:'fuelType',operator:'EQUAL',value:'ELECTRIC'},{field:'policyType',operator:'EQUAL',value:pt},...rangeConditions('gvw',clean(r[offset+2]).replace(/_/g,' ').replace('UPTO','<='))],r[offset+4],pt==='SATP'?'TP':'NET',210,excelColumn(offset+4));if(rr)rules.push(rr);}}}

function parseOther(sheets:ExcelSheet[],ctx:any,rules:ImportedRule[]){parseSchoolBus(sheets.find(s=>s.name==='School Bus'),ctx,rules);parseTractor(sheets.find(s=>s.name==='Tractor'),ctx,rules);parseTaxi(sheets.find(s=>s.name==='Taxi Comp'),ctx,rules);parse2wComp(sheets.find(s=>s.name==='2w Comp'),ctx,rules);parse2wStp(sheets.find(s=>s.name==='2W STP'),ctx,rules);parse3wPcvComp(sheets.find(s=>s.name==='3W PCV Comp'),ctx,rules);parsePcvStp(sheets.find(s=>s.name==='PCV STP'),ctx,rules);parse3wEvComp(sheets.find(s=>s.name==='3W - EV - Comp'),ctx,rules);parseEvStp(sheets.find(s=>s.name==='EV STP'),ctx,rules);parseGcv4wStp(sheets.find(s=>s.name==='GCV STP -4W NonEV'),ctx,rules);parseGcv3w(sheets.find(s=>s.name==='GCV -3W NonEV'),ctx,rules,false);parseGcv3w(sheets.find(s=>s.name==='GCV - 3W EV'),ctx,rules,true);parseGcv4wEv(sheets.find(s=>s.name==='GCV 4W EV'),ctx,rules);}

function parsePcMatrix(sh:ExcelSheet,ctx:any,rules:ImportedRule[]){const locRow=sh.rows[3]||[];for(let i=4;i<sh.rows.length;i++){const r=sh.rows[i]||[];const bt=upper(r[0]);const cc=clean(r[1]);const ncb=upper(r[2]);if(!bt||!cc)continue;let pt='';let age:ImportedCondition[]=[];if(bt.includes('SAOD'))pt='SAOD';else if(bt.includes('COMP'))pt='COMP_1_1';else continue;if(bt.includes('NEW'))age=[{field:'vehicleAge',operator:'EQUAL',value:0}];else age=[{field:'vehicleAge',operator:'GT',value:0}];for(let col=3;col<r.length;col++){const p=numeric(r[col]);const loc=clean(locRow[col]);if(p===null||!loc)continue;const c:ImportedCondition[]=[{field:'rtoCluster',operator:'EQUAL',value:upper(loc)},{field:'policyType',operator:'EQUAL',value:pt},...age,...ccConditions(cc)];if(ncb.includes('WITH')&&!ncb.includes('WITHOUT'))c.push({field:'ncb',operator:'GT',value:0});else if(ncb.includes('WITHOUT'))c.push({field:'ncb',operator:'EQUAL',value:0});rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-PC-${i+1}-${col+1}`,'PRIVATE_CAR',c,p,pt==='SAOD'?'OD':'NET',230,excelColumn(col),clean(r[col])));}}
}
function parsePcStp(sh:ExcelSheet|undefined,ctx:any,rules:ImportedRule[]){if(!sh)return;for(let i=3;i<sh.rows.length;i++){const r=sh.rows[i]||[];const st=clean(r[0]),loc=clean(r[1]);if(!st||!loc)continue;const specs=[{col:2,fuel:'DIESEL',cc:'<1000'},{col:3,fuel:'DIESEL',cc:'1000-1500'},{col:4,fuel:'DIESEL',cc:'>1500'},{col:5,fuel:'PETROL_GROUP',cc:'<1000'},{col:6,fuel:'PETROL',cc:'1000-1500'},{col:7,fuel:'PETROL',cc:'>1500'}];for(const sp of specs){const c:ImportedCondition[]=[...geoConditions(st,loc),{field:'policyType',operator:'EQUAL',value:'SATP'},...rangeConditions('cc',sp.cc)];if(sp.fuel==='PETROL_GROUP')c.push({field:'fuelType',operator:'IN',value:['PETROL','CNG','LPG','HYBRID']});else c.push({field:'fuelType',operator:'EQUAL',value:sp.fuel});const rr=payout(ctx.fileName,sh.name,i+1,`ROY-${ctx.version}-PC-STP-${i+1}-${sp.col}`,'PRIVATE_CAR',c,r[sp.col],'TP',220,excelColumn(sp.col));if(rr)rules.push(rr);}}}
function parsePrivateCar(sheets:ExcelSheet[],ctx:any,rules:ImportedRule[]){for(const sh of sheets.filter(s=>/^Pvt Car- 4W-COMP & SAOD/i.test(s.name)))parsePcMatrix(sh,ctx,rules);parsePcStp(sheets.find(s=>s.name==='Pvt Car STP'),ctx,rules);}

function parseMaster(sheets:ExcelSheet[],ctx:any,maps:ImportedRtoMapping[]){const sh=sheets.find(s=>upper(s.name)==='MASTER');if(!sh)return;for(let i=1;i<sh.rows.length;i++){const r=sh.rows[i]||[];const code=normalizeRto(r[0]);if(!/^[A-Z]{2}-\d{2}$/.test(code))continue;const pc=clean(r[2]),cv=clean(r[4]),stPc=stateAlias(r[3]),stCv=stateAlias(r[5]);if(pc){for(const prod of ['PRIVATE_CAR','TWO_WHEELER'])maps.push({rtoCode:code,originalRtoCode:clean(r[0]),product:prod,cluster:upper(pc),state:stPc||undefined,location:clean(r[1])||undefined,mappingClass:prod==='PRIVATE_CAR'?'PRIVATE_CAR':'TWO_WHEELER',source:{fileName:ctx.fileName,sheet:sh.name,row:i+1}});}if(cv){for(const prod of ['GCV','PCV'])maps.push({rtoCode:code,originalRtoCode:clean(r[0]),product:prod,cluster:upper(cv),state:stCv||undefined,location:clean(r[1])||undefined,mappingClass:prod,source:{fileName:ctx.fileName,sheet:sh.name,row:i+1}});}}}

export function parseRoyalSundaramWorkbook(sheets:ExcelSheet[],ctx:{fileName:string;version:string}):GridImportResult{
  const rules:ImportedRule[]=[];const rtoMappings:ImportedRtoMapping[]=[];
  parseGcvComp(sheets,ctx,rules);parseOther(sheets,ctx,rules);parsePrivateCar(sheets,ctx,rules);parseMaster(sheets,ctx,rtoMappings);
  const seen=new Set<string>();const dedup=rules.filter(r=>{if(seen.has(r.ruleCode))return false;seen.add(r.ruleCode);return true;});
  return {insurerCode:'ROYAL_SUNDARAM',fileName:ctx.fileName,rules:dedup,rtoMappings,warnings:[
    'Royal Sundaram parser imports the supplied GCV, PCV, 2W, EV, tractor and Private Car payout tables. Source notes are modeled only where deterministic; unsupported free-text conditions remain unexecuted rather than guessed.',
    'Royal GCV new-vehicle and make adjustments are applied from explicit workbook notes; OD-discount increment requires odDiscountPercent.'
  ],errors:(dedup.length||rtoMappings.length)?[]:['No Royal Sundaram executable rules or mappings detected']};
}
