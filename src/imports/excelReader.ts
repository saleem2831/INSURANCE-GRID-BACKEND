import * as XLSX from "xlsx";

export interface ExcelSheet {
  name: string;
  rows: any[][];
}

export function readExcelBuffer(
  buffer: Buffer
): ExcelSheet[] {

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true
  });

  return workbook.SheetNames.map(
    sheetName => {

      const sheet =
        workbook.Sheets[sheetName];

      const rows =
        XLSX.utils.sheet_to_json<any[]>(
          sheet,
          {
            header: 1,
            defval: null,
            raw: false
          }
        );

      return {
        name: sheetName,
        rows
      };
    }
  );
}