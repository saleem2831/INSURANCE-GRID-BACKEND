import fs from 'fs/promises';
import { extractPdfText } from '../imports/pdfReader';
import { parsePdfForCompany } from '../imports/pdfParserRegistry';

const samples = [
  ['CHOLA_MS', "/mnt/data/_ready1/READY/CHOLA - PDF to EXCEL/CHOLA September'26.pdf"],
  ['IFFCO_TOKIO', '/mnt/data/_ready1/READY/IFFCO - DATA(GREENorRED)/IFFCO GRID.pdf'],
  ['UNITED_INDIA', '/mnt/data/_ready1/READY/UNITED-STATEWISR/United SEP.pdf'],
  ['NATIONAL_INSURANCE', '/mnt/data/_ready1/READY/NATIONAL-NO RTO DEPENDENCY/National SEP.pdf']
] as const;

async function main(){
  for (const [code,file] of samples){
    const b=await fs.readFile(file);
    const ext=await extractPdfText(b,file.split('/').pop()!);
    const parsed=parsePdfForCompany(code,ext.pages,{fileName:file.split('/').pop()!,version:'SEP-2026'});
    console.log(JSON.stringify({code,extractor:ext.extractor,ocrUsed:ext.ocrUsed,pages:ext.pages.length,rules:parsed.rules.length,mappings:parsed.rtoMappings.length,errors:parsed.errors,warnings:parsed.warnings.slice(0,2)},null,2));
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
