import { ExcelSheet } from '../excelReader';
import { GridImportResult, ImportedCondition, ImportedRule } from '../types';
import { clean, excelColumn, makePayoutRule, normalizePolicyType, rangeConditions, result, rule, upper } from './helpers';

function headerSegment(header: string): { product: string; conditions: ImportedCondition[] } {
  const u = upper(header); const c: ImportedCondition[] = []; let product = 'GCV';
  if (u.includes('PCV') || u.includes('SCHOOL BUS') || u.includes('STAFF BUS') || u.includes('TAXI')) product = 'PCV';
  if (u.includes('3W')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: '3W' });
  if (u.includes('ELECTRIC')) c.push({ field: 'fuelType', operator: 'EQUAL', value: 'ELECTRIC' });
  if (u.includes('SCHOOL')) c.push({ field: 'vehicleUse', operator: 'EQUAL', value: 'SCHOOL' });
  if (u.includes('STAFF')) c.push({ field: 'vehicleUse', operator: 'EQUAL', value: 'STAFF' });
  if (u.includes('TAXI')) c.push({ field: 'vehicleUse', operator: 'EQUAL', value: 'TAXI' });
  if (u.includes('TANKER')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'TANKER' });
  if (u.includes('TIPPER') || u.includes('DUMPER')) c.push({ field: 'vehicleType', operator: 'IN', value: ['TIPPER','DUMPER'] });
  if (u.includes('TRUCK')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'TRUCK' });
  if (u.includes('TRAILER')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'TRAILER' });
  if (u.includes('TRACTOR')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'TRACTOR' });
  if (u.includes('MISC D') || u.includes('CE')) c.push({ field: 'vehicleType', operator: 'EQUAL', value: 'MISC_D' });
  if (u.includes('NEW')) c.push({ field: 'vehicleAge', operator: 'EQUAL', value: 0 });
  if (u.includes('OLD')) c.push({ field: 'vehicleAge', operator: 'GT', value: 0 });
  if (u.includes('<2450')) c.push({ field: 'gvw', operator: 'LT', value: 2450 });
  else if (u.includes('>= 2450') || u.includes('>=2450')) { c.push({ field: 'gvw', operator: 'GTE', value: 2450 }); c.push({ field: 'gvw', operator: 'LTE', value: 3500 }); }
  else if (u.includes('3.5-7.5')) c.push({ field: 'gvw', operator: 'BETWEEN', value: [3500,7500] });
  else if (u.includes('7.5-12')) c.push({ field: 'gvw', operator: 'BETWEEN', value: [7500,12000] });
  else if (u.includes('12-20')) c.push({ field: 'gvw', operator: 'BETWEEN', value: [12000,20000] });
  else if (u.includes('20-40')) c.push({ field: 'gvw', operator: 'BETWEEN', value: [20000,40000] });
  else if (u.includes('>40')) c.push({ field: 'gvw', operator: 'GT', value: 40000 });
  let m=u.match(/SCHOOL BUS\s*<(\d+)/); if(m)c.push({field:'seatingCapacity',operator:'LT',value:+m[1]});
  m=u.match(/(?:SCHOOL|STAFF) BUS\s*(\d+)-(\d+)/);if(m)c.push({field:'seatingCapacity',operator:'BETWEEN',value:[+m[1],+m[2]]});
  m=u.match(/(?:SCHOOL|STAFF) BUS\s*>(\d+)/);if(m)c.push({field:'seatingCapacity',operator:'GT',value:+m[1]});
  m=u.match(/TAXI<=([\d]+)CC/);if(m)c.push({field:'cc',operator:'LTE',value:+m[1]});
  m=u.match(/TAXI>([\d]+)CC/);if(m)c.push({field:'cc',operator:'GT',value:+m[1]});
  return { product, conditions: c };
}

function ageToken(token:string):ImportedCondition[]{const u=upper(token).replace(/YEARS?|YRS?/g,'').trim();let m=u.match(/(\d+)\s*[-–]\s*(\d+)/);if(m)return[{field:'vehicleAge',operator:'BETWEEN',value:[+m[1],+m[2]]}];m=u.match(/>=\s*(\d+)/);if(m)return[{field:'vehicleAge',operator:'GTE',value:+m[1]}];m=u.match(/(\d+)\+/);if(m)return[{field:'vehicleAge',operator:'GTE',value:+m[1]}];return[];}

function clauseConditions(tokens:string[], siblingSpecificMakes:string[]): {conditions:ImportedCondition[]; unsupported:string[]} {
  const c:ImportedCondition[]=[]; const unsupported:string[]=[];
  const makeMap:Record<string,string>={'TATA':'TATA','TATAMOTORS':'TATA','EICHER':'EICHER','M&M':'M&M','MAHINDRA':'M&M','AL':'ASHOK LEYLAND','ASHOKLEYLAND':'ASHOK LEYLAND','PIAGGIO':'PIAGGIO','MARUTI':'MARUTI','OMNI':'OMNI','MAGIC':'MAGIC','EECO':'EECO','BACKHOELOADER':'BACKHOELOADER','WHEELLOADER':'WHEELLOADER','EXCAVATOR':'EXCAVATOR'};
  const models:string[]=[]; const makes:string[]=[];
  for(const raw of tokens){const t=upper(raw).replace(/\s+/g,'');if(!t||t==='COMP'||t==='AOTP'||t==='NEW'||t==='OLD'||t==='OTHERS')continue;
    if(t==='COMP')c.push({field:'policyType',operator:'EQUAL',value:'COMP'});else if(t==='AOTP')c.push({field:'policyType',operator:'EQUAL',value:'AOTP'});
    const ages=ageToken(raw);if(ages.length){c.push(...ages);continue;}
    if(makeMap[t]){if(['OMNI','MAGIC','EECO','BACKHOELOADER','WHEELLOADER','EXCAVATOR'].includes(t))models.push(makeMap[t]);else makes.push(makeMap[t]);continue;}
    if(/^[A-Z]{2,}\d+$/.test(t)){c.push({field:'rtoSubCluster',operator:'EQUAL',value:t});continue;}
    unsupported.push(raw);
  }
  if(tokens.some(x=>upper(x)==='COMP'))c.push({field:'policyType',operator:'EQUAL',value:'COMP'});
  if(tokens.some(x=>upper(x)==='AOTP'))c.push({field:'policyType',operator:'EQUAL',value:'AOTP'});
  if(tokens.some(x=>upper(x)==='NEW'))c.push({field:'vehicleAge',operator:'EQUAL',value:0});
  if(tokens.some(x=>upper(x)==='OLD'))c.push({field:'vehicleAge',operator:'GT',value:0});
  if(makes.length)c.push({field:'make',operator:'IN',value:[...new Set(makes)]});
  if(models.length)c.push({field:'model',operator:'IN',value:[...new Set(models)]});
  if(tokens.some(x=>upper(x)==='OTHERS')&&siblingSpecificMakes.length)c.push({field:'make',operator:'NOT_IN',value:[...new Set(siblingSpecificMakes)]});
  return {conditions:c,unsupported};
}

function compileCell(ctx:any,sh:ExcelSheet,rowIndex:number,col:number,code:string,product:string,base:ImportedCondition[],value:unknown):ImportedRule[]{
  const text=clean(value); const simple=result(value,'GWP'); if(!text||!simple)return[];
  if(simple.type!=='MANUAL_REVIEW'){const rr=rule(ctx.fileName,sh.name,rowIndex+1,code,product,base,value,'GWP',100,excelColumn(col));return rr?[rr]:[];}
  const clauses=text.split(/\s*,\s*/).filter(Boolean); const parsed=clauses.map(cl=>{const idx=cl.lastIndexOf(':');if(idx<0)return null;const left=cl.slice(0,idx),right=cl.slice(idx+1);const p=(right.match(/[\d.]+/)||[])[0];if(p===undefined)return null;return{tokens:left.split('|').map(x=>x.trim()).filter(Boolean),percentage:+p,raw:cl};}).filter(Boolean) as Array<{tokens:string[];percentage:number;raw:string}>;
  if(!parsed.length)return[{ruleCode:code,product,priority:100,ruleKind:'BASE',conditions:base,result:{type:'MANUAL_REVIEW',reason:`Uncompiled ICICI expression: ${text}`},source:{fileName:ctx.fileName,sheet:sh.name,row:rowIndex+1,column:excelColumn(col),originalText:text}}];
  const specificMakes:string[]=[];for(const p of parsed)for(const t of p.tokens){const u=upper(t).replace(/\s+/g,'');if(['TATA','TATAMOTORS','EICHER','M&M','MAHINDRA','AL','ASHOKLEYLAND','PIAGGIO','MARUTI'].includes(u))specificMakes.push(u==='AL'?'ASHOK LEYLAND':u==='TATAMOTORS'?'TATA':u==='MAHINDRA'?'M&M':u);}
  const out:ImportedRule[]=[];parsed.forEach((p,j)=>{const extra=clauseConditions(p.tokens,specificMakes);if(extra.unsupported.length){out.push({ruleCode:`${code}-C${j+1}`,product,priority:110,ruleKind:'BASE',conditions:[...base,...extra.conditions],result:{type:'MANUAL_REVIEW',reason:`ICICI clause contains unsupported qualifier(s): ${extra.unsupported.join(', ')}`},source:{fileName:ctx.fileName,sheet:sh.name,row:rowIndex+1,column:excelColumn(col),originalText:p.raw}});}else out.push(makePayoutRule(ctx.fileName,sh.name,rowIndex+1,`${code}-C${j+1}`,product,[...base,...extra.conditions],p.percentage,'GWP',110,excelColumn(col),p.raw));});return out;
}

function parseMatrix(sh:ExcelSheet,ctx:any,rules:ImportedRule[],aotp=false){const hdr=sh.rows[0]||[];for(let i=1;i<sh.rows.length;i++){const r=sh.rows[i]||[];const cluster=clean(r[0]);if(!cluster)continue;for(let col=1;col<hdr.length;col++){const head=clean(hdr[col]);if(!head||r[col]===undefined||clean(r[col])==='')continue;const seg=headerSegment(head);const base:ImportedCondition[]=[{field:'rtoCluster',operator:'EQUAL',value:cluster},...seg.conditions];if(aotp)base.push({field:'policyType',operator:'EQUAL',value:'AOTP'});rules.push(...compileCell(ctx,sh,i,col,`ICI-${ctx.version}-${aotp?'AOTP':'CV'}-R${i+1}-C${col+1}`,seg.product,base,r[col]));}}}

function parseCouncilCalls(sh:ExcelSheet,ctx:any,rules:ImportedRule[]){for(let i=1;i<sh.rows.length;i++){const r=sh.rows[i]||[];if(upper(r[10])!=='ACTIVE')continue;const p=Number(r[9]);if(!Number.isFinite(p))continue;const ton=upper(r[2]);const product=ton.includes('PCV')?'PCV':'GCV';const c:ImportedCondition[]=[];const state=upper(r[1]);if(state&&state!=='ALL')c.push({field:'rtoState',operator:'EQUAL',value:state});c.push(...rangeConditions('gvw',ton));const age=upper(r[3]);if(age==='0'||age==='0 YRS')c.push({field:'vehicleAge',operator:'EQUAL',value:0});else if(age.startsWith('>0'))c.push({field:'vehicleAge',operator:'GT',value:0});const trans=upper(r[4]);if(trans==='NEW')c.push({field:'vehicleAge',operator:'EQUAL',value:0});else if(trans==='OLD')c.push({field:'vehicleAge',operator:'GT',value:0});const makes=clean(r[5]).split(/\n|,|&/).map(x=>upper(x)).filter(x=>x&&x!=='ALL');if(makes.length)c.push({field:'make',operator:'IN',value:makes});const locs=clean(r[7]).split(/\n|,/).map(x=>upper(x)).filter(x=>x&&x!=='ALL'&&!x.includes('DISTRICTS')&&!x.includes('RTO'));if(locs.length)c.push({field:'rtoRegion',operator:'IN',value:locs});const pol=upper(r[8]);if(pol&&pol!=='ALL'){const np=normalizePolicyType(pol);if(np)c.push({field:'policyType',operator:'EQUAL',value:np});}const fuel=upper(r[11]);if(fuel&&fuel!=='ALL')c.push({field:'fuelType',operator:'EQUAL',value:fuel});rules.push(makePayoutRule(ctx.fileName,sh.name,i+1,`ICI-${ctx.version}-CC-R${i+1}`,product,c,Math.abs(p)<=1?p*100:p,'GWP',1000,excelColumn(9),clean(r[9])));}}

export function parseIciciWorkbook(sheets:ExcelSheet[],ctx:{fileName:string;version:string}):GridImportResult{const rules:ImportedRule[]=[];const overall=sheets.find(s=>s.name==='CV Overall Grid');if(overall)parseMatrix(overall,ctx,rules,false);const aotp=sheets.find(s=>s.name==='CV AOTP Grid');if(aotp)parseMatrix(aotp,ctx,rules,true);const cc=sheets.find(s=>s.name==='Council Calls');if(cc)parseCouncilCalls(cc,ctx,rules);return{insurerCode:'ICICI',fileName:ctx.fileName,rules,rtoMappings:[],warnings:['ICICI V4 compiles simple numeric/No Biz/CC cells and common pipe-delimited make/new-old/age/model clauses. Unsupported qualifiers remain MANUAL_REVIEW. Active Council Calls are imported as higher-priority overrides.','The supplied ICICI workbook has location/cluster data but no canonical RTO-code column. V4 derives state/location from trusted RTO mappings when available and asks for rtoCluster/rtoSubCluster only when it cannot resolve them uniquely.'],errors:rules.length?[]:['No ICICI executable rules detected']};}
