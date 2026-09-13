import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedCondition, ImportedRtoMapping, ImportedRule } from '../types';
import { clean, excelColumn, makePayoutRule, normalizePolicyType, normalizeRto, pct, rule, upper } from './helpers';

const STATE_ALIASES: Record<string,string> = {
  'ANDRA PRADESH':'ANDHRA PRADESH','CHATTISGARH':'CHHATTISGARH','MP':'MADHYA PRADESH',
  'WB':'WEST BENGAL','ORISSA':'ODISHA','UTTARANCHAL':'UTTARAKHAND','J&K':'JAMMU AND KASHMIR'
};
const stateAlias = (v: unknown) => STATE_ALIASES[upper(v)] || upper(v);
const isAll = (v: unknown) => !clean(v) || /^(ALL|ALL RTOS?|ALL RTO|ALL LOCATIONS?)$/i.test(clean(v)) || /\*$/.test(clean(v));

function statesFrom(v: unknown): string[] {
  const s=stateAlias(v);
  if (!s) return [];
  if (s === 'DELHI NCR') return ['DELHI','HARYANA','UTTAR PRADESH'];
  return s.split(/\s*,\s*/).map(stateAlias).filter(Boolean);
}

function locationConditions(state: string, location: string): { conditions: ImportedCondition[]; priority: number } {
  const states=statesFrom(state);
  const base: ImportedCondition[] = states.length>1
    ? [{ field:'rtoState', operator:'IN', value:states }]
    : states.length ? [{ field:'rtoState', operator:'EQUAL', value:states[0] }] : [];
  const u = upper(location).replace(/\*$/,'').trim();
  if (!u || /^ALL(?: RTOS?)?$/.test(u) || u.includes('ALL EXCLUDING DECLINED') || u.startsWith('OTHERS') || u===upper(state).replace(/\*$/,'')) return { conditions: base, priority: 90 };
  if (u === 'GOOD') return { conditions: [...base, { field: 'rtoRegion', operator: 'EQUAL', value: 'GOOD' }], priority: 150 };
  if (u === 'BAD') return { conditions: [...base, { field: 'rtoRegion', operator: 'EQUAL', value: 'BAD' }], priority: 260 };
  const parts = u.split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/^AHEMEDABAD$/, 'AHMEDABAD'));
  return { conditions: [...base, { field: 'rtoRegion', operator: parts.length>1?'IN':'EQUAL', value: parts.length>1?parts:parts[0] } as ImportedCondition], priority: 170 };
}

function fuelCondition(v: unknown): ImportedCondition[] {
  const parts=upper(v).split(/[\/,]/).map(x=>x.trim()).filter(Boolean).map(x=>x==='EV'?'ELECTRIC':x);
  if (!parts.length || parts.includes('ALL')) return [];
  return [{field:'fuelType',operator:parts.length>1?'IN':'EQUAL',value:parts.length>1?parts:parts[0]} as ImportedCondition];
}

function businessTypeCondition(v: unknown): ImportedCondition[] {
  const s=upper(v).replace(/-/g,' ').replace(/\s+/g,' ').trim();
  if (!s || s==='ALL') return [];
  if (s==='NEW') return [{field:'businessType',operator:'EQUAL',value:'NEW'}];
  if (s.includes('NON NEW') || s.includes('NONNEW')) return [{field:'businessType',operator:'EQUAL',value:'NON_NEW'}];
  return [{field:'businessType',operator:'EQUAL',value:s.replace(/\s+/g,'_')}];
}

function segmentVehicleCondition(v: unknown): ImportedCondition[] {
  const s=upper(v);
  if (s.includes('SCOOTER') || s.includes('MOPED')) return [{field:'vehicleType',operator:'EQUAL',value:'SCOOTER'}];
  if (s.includes('BIKE') || s.includes('MOTOR')) return [{field:'vehicleType',operator:'EQUAL',value:'MOTOR_CYCLE'}];
  return [];
}

function excludedMakes(text: unknown): string[] {
  const s=upper(text);
  const m=s.match(/EXC(?:EPT|LUDING)?\s+(.+)/);
  if(!m) return [];
  return m[1].split(/[,/&]/).map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/\.$/,''));
}

function cellRules(args: {
  fileName: string; sheet: string; row: number; col: number; code: string; product: string;
  conditions: ImportedCondition[]; value: unknown; basis?: any; priority: number;
}): ImportedRule[] {
  const { fileName, sheet, row, col, code, product, conditions, value, priority } = args;
  const text = clean(value); const u = upper(text); const column = excelColumn(col); const out: ImportedRule[] = [];
  if (!text || u === 'NA' || u === 'N/A' || u === '-') return out;
  let m = u.match(/([\d.]+)%\s*,?\s*<\s*5\s*YEARS?\s*DECLINE/);
  if (m) {
    out.push({ ruleCode:`${code}-DECLINE`, product, priority:priority+1000, ruleKind:'EXCLUSION', conditions:[...conditions,{field:'vehicleAge',operator:'LT',value:5}], result:{type:'DECLINE',reason:text}, source:{fileName,sheet,row,column,originalText:text} });
    out.push(makePayoutRule(fileName,sheet,row,`${code}-PAY`,product,[...conditions,{field:'vehicleAge',operator:'GTE',value:5}],Number(m[1]),args.basis||'GWP',priority,column,text)); return out;
  }
  const agePairs=[...u.matchAll(/(?:AGE\s*)?(\d+(?:\.\d+)?)\s*(?:-|TO)\s*(\d+(?:\.\d+)?)\s*:?\s*([\d.]+)%/g)];
  if(agePairs.length){agePairs.forEach((x,i)=>out.push(makePayoutRule(fileName,sheet,row,`${code}-AGE-${i+1}`,product,[...conditions,{field:'vehicleAge',operator:'BETWEEN',value:[Number(x[1]),Number(x[2])]}],Number(x[3]),args.basis||'GWP',priority+20,column,text))); return out;}
  const plus=[...u.matchAll(/(?:AGE\s*)?(\d+(?:\.\d+)?)\s*\+\s*(?:YEARS?)?\s*:?\s*([\d.]+)%/g)];
  if(plus.length){plus.forEach((x,i)=>out.push(makePayoutRule(fileName,sheet,row,`${code}-AGEPLUS-${i+1}`,product,[...conditions,{field:'vehicleAge',operator:'GTE',value:Number(x[1])}],Number(x[2]),args.basis||'GWP',priority+20,column,text))); return out;}
  const rr = rule(fileName,sheet,row,code,product,conditions,value,args.basis||'GWP',priority,column); if(rr) out.push(rr); return out;
}

function sectionConditions(label: string): ImportedCondition[] {
  const u=upper(label); if(u.startsWith('3W')) return [{field:'vehicleCategory',operator:'EQUAL',value:'3W'}];
  const pairs:Array<[RegExp,number,number?]>=[[/0-2\.5T/,0,2500],[/2\.5T-3\.5T/,2500,3500],[/3\.5T-7\.5T/,3500,7500],[/7\.5T-12T/,7500,12000],[/12T-17T/,12000,17000],[/20-25T/,20000,25000]];
  for(const [re,lo,hi] of pairs) if(re.test(u)){const c:ImportedCondition[]=[{field:'vehicleCategory',operator:'NOT_EQUAL',value:'3W'}]; if(lo>0)c.push({field:'gvw',operator:'GT',value:lo}); if(hi)c.push({field:'gvw',operator:'LTE',value:hi}); return c;} return [];
}

function parseRtoGroups(sheet: ExcelSheet | undefined, product='ALL'): ImportedRtoMapping[] {
  if(!sheet) return []; const maps:ImportedRtoMapping[]=[]; let currentHeaders:Record<number,string>={};
  for(let i=0;i<sheet.rows.length;i++){
    const row=sheet.rows[i]||[], next=sheet.rows[i+1]||[]; const nextHasRto=next.some(v=>upper(v)==='RTO');
    if(nextHasRto){currentHeaders={}; row.forEach((v,col)=>{if(clean(v)) currentHeaders[col]=upper(v).replace('BENGALURU','BANGALORE');}); continue;}
    for(const [colText,header] of Object.entries(currentHeaders)){
      const col=Number(colText); if(upper(sheet.rows[i-1]?.[col])==='RTO') continue; const code=normalizeRto(row[col]); if(!/^[A-Z]{2}-\d{2}$/.test(code)) continue;
      const location=clean(row[col+1]); let region=header, mappingClass='REGION'; if(/DECLIN/.test(header)){region='DECLINED';mappingClass='DECLINED_REGION';}
      maps.push({rtoCode:code,originalRtoCode:clean(row[col]),product,cluster:region,region,location,mappingClass,source:{sheet:sheet.name,row:i+1}});
    }
  } return maps;
}

function parsePrivateCarSatp(sheets:ExcelSheet[],ctx:any){
  const rules:ImportedRule[]=[]; const mappings:ImportedRtoMapping[]=[]; const grid=sheets.find(s=>s.name==='Grid' && upper(s.rows[1]?.[0])==='ZONE');
  if(!grid) return {rules,mappings};
  for(let i=2;i<grid.rows.length;i++){
    const r=grid.rows[i]||[]; const state=clean(r[1]), location=clean(r[2]), fuel=clean(r[3]); const p=pct(r[4]); if(!state||p===null)continue;
    const loc=locationConditions(state,location); const base=[...loc.conditions,...fuelCondition(fuel),{field:'policyType',operator:'EQUAL',value:'SATP'} as ImportedCondition];
    rules.push(makePayoutRule(ctx.fileName,grid.name,i+1,`HDFC-${ctx.version}-PC-SATP-${i+1}-GE1000`,'PRIVATE_CAR',[...base,{field:'cc',operator:'GTE',value:1000}],p,'TP',loc.priority+20,'E',clean(r[4])));
    rules.push(makePayoutRule(ctx.fileName,grid.name,i+1,`HDFC-${ctx.version}-PC-SATP-${i+1}-LT1000`,'PRIVATE_CAR',[...base,{field:'cc',operator:'LT',value:1000}],Math.max(0,p-5),'TP',loc.priority+20,'E',`${clean(r[4])}; source note: 0-1000cc is 5 percentage points lower`));
  }
  const rto=sheets.find(s=>upper(s.name)==='RTO CODE MASTER');
  if(rto){for(let i=1;i<rto.rows.length;i++){const r=rto.rows[i]||[];const code=normalizeRto(r[3]); if(!/^[A-Z]{2}-\d{2}$/.test(code))continue; const loc=upper(r[1]); mappings.push({rtoCode:code,originalRtoCode:clean(r[3]),product:'ALL',cluster:loc||stateAlias(r[0]),region:loc||undefined,state:stateAlias(r[0]),location:clean(r[2])||loc,source:{fileName:ctx.fileName,sheet:rto.name,row:i+1}});}}
  const blocked=sheets.find(s=>upper(s.name).includes('BLOCK MODELS'));
  if(blocked){for(let i=1;i<blocked.rows.length;i++){const r=blocked.rows[i]||[]; if(!clean(r[6])&&!clean(r[7])&&!clean(r[11])&&!clean(r[12]))continue; const c:ImportedCondition[]=[{field:'policyType',operator:'EQUAL',value:'SATP'}];
    if(upper(r[5])!=='ALL'&&clean(r[5]))c.push({field:'businessType',operator:'EQUAL',value:upper(r[5]).replace(/\s+/g,'_')});
    if(upper(r[6])!=='ALL'&&clean(r[6]))c.push({field:'make',operator:'EQUAL',value:upper(r[6])});
    if(upper(r[7])!=='ALL'&&clean(r[7])){const models=upper(r[7]).split(',').map(x=>x.trim()).filter(Boolean);c.push({field:'model',operator:models.length>1?'IN':'EQUAL',value:models.length>1?models:models[0]} as ImportedCondition);}
    if(upper(r[10])!=='ALL'&&clean(r[10]))c.push(...fuelCondition(r[10]));
    if(upper(r[11])!=='ALL'&&clean(r[11]))c.push({field:'rtoState',operator:'EQUAL',value:stateAlias(r[11])});
    if(upper(r[12])!=='ALL'&&clean(r[12]))c.push({field:'rtoRegion',operator:'EQUAL',value:upper(r[12])});
    if(upper(r[13])==='Y')c.push({field:'ncb',operator:'GT',value:0}); else if(upper(r[13])==='N')c.push({field:'ncb',operator:'EQUAL',value:0});
    if(upper(r[14])==='Y')c.push({field:'addOnCover',operator:'EQUAL',value:true}); else if(upper(r[14])==='N')c.push({field:'addOnCover',operator:'EQUAL',value:false});
    rules.push({ruleCode:`HDFC-${ctx.version}-PC-BLOCK-${i+1}`,product:'PRIVATE_CAR',priority:9000,ruleKind:'EXCLUSION',conditions:c,result:{type:'DECLINE',reason:'HDFC source block-model list'},source:{fileName:ctx.fileName,sheet:blocked.name,row:i+1,column:'A:O',originalText:r.map(clean).filter(Boolean).join(' | ')}});
  }}
  return {rules,mappings};
}

function parseTwGrid(sheets:ExcelSheet[],ctx:any){
  const rules:ImportedRule[]=[]; const grid=sheets.find(s=>{const h=(s.rows[0]||[]).map(upper);return h.includes('POLICY TYPE')&&h.includes('SEGMENT')&&h.some(x=>x.includes('BDE'));});
  if(!grid)return {rules,mappings:[] as ImportedRtoMapping[]}; const h=(grid.rows[0]||[]).map(upper); const ix=(name:string)=>h.findIndex(x=>x===name||x.includes(name));
  const cPolicy=ix('POLICY TYPE'),cSeg=ix('SEGMENT'),cFuel=ix('FUEL'),cState=ix('STATE'),cLoc=ix('LOCATION'),cRemark=Math.max(ix('REMARK'),ix('REMARKS')),cBde=h.findIndex(x=>x.includes('BDE'));
  for(let i=1;i<grid.rows.length;i++){const r=grid.rows[i]||[];const p=pct(r[cBde]);if(p===null)continue;const pt=normalizePolicyType(r[cPolicy]);const loc=locationConditions(clean(r[cState]),clean(r[cLoc]));const c:ImportedCondition[]=[...loc.conditions,...segmentVehicleCondition(r[cSeg]),...fuelCondition(r[cFuel])];if(pt)c.push({field:'policyType',operator:'EQUAL',value:pt});
    const ex=excludedMakes(r[cRemark]);if(ex.length)rules.push({ruleCode:`HDFC-${ctx.version}-TW-EX-${i+1}`,product:'TWO_WHEELER',priority:8000,ruleKind:'EXCLUSION',conditions:[...c,{field:'make',operator:'IN',value:ex}],result:{type:'DECLINE',reason:clean(r[cRemark])},source:{fileName:ctx.fileName,sheet:grid.name,row:i+1,column:excelColumn(cRemark),originalText:clean(r[cRemark])}});
    rules.push(makePayoutRule(ctx.fileName,grid.name,i+1,`HDFC-${ctx.version}-TW-${i+1}`,'TWO_WHEELER',c,p,pt==='SATP'?'TP':'GWP',loc.priority+30,excelColumn(cBde),clean(r[cBde])));
  } return {rules,mappings:[] as ImportedRtoMapping[]};
}

function parse3w(sheets:ExcelSheet[],ctx:any){
  const rules:ImportedRule[]=[];const grid=sheets.find(s=>upper(s.name).startsWith('3W-GRID'));if(!grid)return {rules,mappings:[] as ImportedRtoMapping[]};
  for(let i=1;i<grid.rows.length;i++){const r=grid.rows[i]||[];const p=pct(r[4]);if(p===null)continue;const loc=locationConditions(clean(r[0]),clean(r[1])); const common:ImportedCondition[]=[...loc.conditions,...businessTypeCondition(r[2]),...fuelCondition(r[3]),{field:'vehicleType',operator:'EQUAL',value:'3W'}];
    for(const product of ['GCV','PCV']) rules.push(makePayoutRule(ctx.fileName,grid.name,i+1,`HDFC-${ctx.version}-3W-${product}-${i+1}`,product,common,p,'GWP',loc.priority+30,'E',clean(r[4])));
    if(/DECLINE OTHER FUEL/i.test(clean(r[5]))){const allowed=fuelCondition(r[3])[0]; if(allowed){const vals=Array.isArray(allowed.value)?allowed.value:[allowed.value];for(const product of ['GCV','PCV'])rules.push({ruleCode:`HDFC-${ctx.version}-3W-EX-${product}-${i+1}`,product,priority:8500,ruleKind:'EXCLUSION',conditions:[...loc.conditions,...businessTypeCondition(r[2]),{field:'vehicleType',operator:'EQUAL',value:'3W'},{field:'fuelType',operator:'NOT_IN',value:vals}],result:{type:'DECLINE',reason:clean(r[5])},source:{fileName:ctx.fileName,sheet:grid.name,row:i+1,column:'F',originalText:clean(r[5])}});}}
  }
  const m=parseRtoGroups(sheets.find(s=>/RTO_MAST/i.test(s.name)),'ALL'); return {rules,mappings:m};
}

function parseLegacy(sheets:ExcelSheet[],ctx:any){
  const rules:ImportedRule[]=[]; const grid=sheets.find(s=>s.name==='Grid');
  if(grid && upper(grid.rows[0]?.[0])!=='ZONE') {let sectionLabel='';for(let i=0;i<grid.rows.length;i++){const row=grid.rows[i]||[];if(upper(row[0])==='STATES'){sectionLabel=clean(row[2]).replace(/\s+(COMP|SATP)$/i,'');continue;}if(!sectionLabel||!clean(row[0]))continue;const loc=locationConditions(stateAlias(row[0]),clean(row[1]));const seg=sectionConditions(sectionLabel);for(const [col,ptype] of [[2,'COMP'],[3,'SATP']] as const){if(!clean(row[col]))continue;rules.push(...cellRules({fileName:ctx.fileName,sheet:grid.name,row:i+1,col,code:`HDFC-${ctx.version}-${i+1}-${col+1}`,product:'GCV',conditions:[...loc.conditions,...seg,{field:'policyType',operator:'EQUAL',value:ptype}],value:row[col],priority:loc.priority}));}}}
  const mappings=parseRtoGroups(sheets.find(s=>s.name==='RTOs'),'GCV');for(const m of mappings.filter(x=>x.mappingClass==='DECLINED_REGION'))rules.push({ruleCode:`HDFC-${ctx.version}-DECL-${m.rtoCode}`,product:'GCV',priority:5000,ruleKind:'EXCLUSION',conditions:[{field:'rtoCode',operator:'EQUAL',value:m.rtoCode}],result:{type:'DECLINE',reason:`Declined RTO in HDFC RTO list (${m.location||m.region})`},source:{fileName:ctx.fileName,sheet:m.source.sheet,row:m.source.row,originalText:m.location||m.region}});
  return {rules,mappings};
}

export function parseHdfcWorkbook(sheets: ExcelSheet[], ctx: { fileName: string; version: string }): GridImportResult {
  const rules:ImportedRule[]=[];const mappings:ImportedRtoMapping[]=[]; const add=(x:{rules:ImportedRule[];mappings:ImportedRtoMapping[]})=>{rules.push(...x.rules);mappings.push(...x.mappings);};
  add(parse3w(sheets,ctx)); add(parsePrivateCarSatp(sheets,ctx)); add(parseTwGrid(sheets,ctx)); add(parseLegacy(sheets,ctx));
  const seenR=new Set<string>();const dedupRules=rules.filter(r=>{if(seenR.has(r.ruleCode))return false;seenR.add(r.ruleCode);return true;});
  const seenM=new Set<string>();const dedupMappings=mappings.filter(m=>{const k=`${m.rtoCode}|${m.product}|${m.cluster}`;if(seenM.has(k))return false;seenM.add(k);return true;});
  return {insurerCode:'HDFC_ERGO',fileName:ctx.fileName,rules:dedupRules,rtoMappings:dedupMappings,warnings:['HDFC parser supports legacy GCV, Sep-2026 3W, TW SAOD/non-new, and Private-Car SATP workbooks. Block-model rows are imported as high-priority exclusions.'],errors:dedupRules.length||dedupMappings.length?[]:['No HDFC executable rules or mappings detected']};
}
