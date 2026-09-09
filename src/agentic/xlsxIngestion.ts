import ExcelJS from 'exceljs';
import { extractTableSegment } from './agenticExtractionUtils';
import { AgenticExtractedSegment, AgenticFileMeta, AgenticIngestionConfig, AgenticXlsxData } from './agenticTypes';

/**
 * Phase 2 — `.xlsx` ingestion. `parseXlsxBuffer()` is the only part of this
 * file that actually touches the `exceljs` library (thin, reviewed rather
 * than unit tested directly — a real workbook only makes sense to parse
 * with the real library); `extractXlsxSegment()`/`buildXlsxPreview()` are
 * pure functions over the ALREADY-PARSED `AgenticXlsxData` shape and are
 * unit tested directly (the test suite builds real workbooks with
 * exceljs's own writer to get real parsed data, then exercises these pure
 * functions against it — see test/agentic/xlsxIngestion.test.ts).
 *
 * Each sheet is normalized into the exact same `string[][]` (header + data
 * rows) shape `csvUtils.ts` already uses for a parsed CSV file, so `.xlsx`
 * row-range/column-selection reuses `agenticExtractionUtils.ts`'s
 * `extractTableSegment()` verbatim — one implementation, two formats.
 */

/** Reads every worksheet in the workbook into a plain grid of already-
 * stringified cell values (`cell.text` — exceljs's own "what would a user
 * see" rendering, so a formula shows its computed result, a date shows its
 * formatted text, not a raw serial number). A completely empty worksheet
 * becomes a sheet with zero rows (still listed, just with nothing to
 * preview/select), never dropped or errored on. */
export async function parseXlsxBuffer(buffer: Buffer): Promise<AgenticXlsxData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheets = workbook.worksheets.map((sheet) => {
    const rows: string[][] = [];
    let width = 0;
    sheet.eachRow({ includeEmpty: true }, (row) => {
      width = Math.max(width, row.cellCount);
    });
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      for (let col = 1; col <= width; col++) {
        const cell = row.getCell(col);
        cells.push(cell.text ?? '');
      }
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });

  return { sheets };
}

export function buildXlsxPreview(data: AgenticXlsxData): AgenticFileMeta['xlsxPreview'] {
  return {
    sheets: data.sheets.map((sheet) => {
      if (sheet.rows.length === 0) {
        return { name: sheet.name, headers: [], dataRowCount: 0 };
      }
      const [header, ...dataRows] = sheet.rows;
      return { name: sheet.name, headers: header, dataRowCount: dataRows.length };
    })
  };
}

/** Resolves which sheet a config actually targets — the named sheet if it
 * still exists, otherwise the workbook's first sheet, exactly like every
 * other "a stale/missing config selection degrades gracefully" rule in
 * this feature (see agenticExtractionUtils.ts's column-name handling). */
function resolveSheet(data: AgenticXlsxData, sheetName: string | undefined) {
  if (sheetName) {
    const found = data.sheets.find((s) => s.name === sheetName);
    if (found) {
      return found;
    }
  }
  return data.sheets[0];
}

export function extractXlsxSegment(fileName: string, data: AgenticXlsxData, config: AgenticIngestionConfig): AgenticExtractedSegment {
  const sheet = resolveSheet(data, config.sheetName);
  if (!sheet) {
    return { fileName, text: '', truncated: false };
  }
  return extractTableSegment(`${fileName} — ${sheet.name}`, sheet.rows, config);
}
