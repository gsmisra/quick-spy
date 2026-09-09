import { stringifyCsv } from './csvUtils';
import { AGENTIC_MAX_SEGMENT_CHARS, AgenticExtractedSegment, AgenticIngestionConfig } from './agenticTypes';

/**
 * Small extraction primitives shared across EVERY format's extractor
 * (textIngestion.ts for csv/json/xml/yaml/text, xlsxIngestion.ts,
 * docxIngestion.ts, pdfIngestion.ts) — kept in their own file specifically
 * so none of those format-specific modules need to import from each other
 * (textIngestion.ts dispatches to the other three, so THEM importing back
 * from textIngestion.ts would be circular). Zero `vscode` import, directly
 * unit-testable.
 */

export function capSegment(fileName: string, text: string): AgenticExtractedSegment {
  if (text.length <= AGENTIC_MAX_SEGMENT_CHARS) {
    return { fileName, text, truncated: false };
  }
  return { fileName, text: text.slice(0, AGENTIC_MAX_SEGMENT_CHARS), truncated: true };
}

/** 1-based inclusive [from, to] slice over an array, tolerating missing
 * bounds (means "from the start"/"to the end") and an out-of-range
 * from > total (yields an empty slice rather than throwing or wrapping).
 * Every format's range control (csv/xlsx row range, text line range, docx
 * heading range, pdf page range) is guaranteed to mean exactly the same
 * thing because they all go through this one function. */
export function sliceRange<T>(items: T[], range: { from?: number; to?: number } | undefined): T[] {
  if (!range) {
    return items;
  }
  const from = Math.max(1, range.from ?? 1);
  const to = Math.min(items.length, range.to ?? items.length);
  if (from > to) {
    return [];
  }
  return items.slice(from - 1, to);
}

/** Row/column projection shared by `'csv'` (parsed from raw text) and
 * `'xlsx'` (parsed by exceljs) — both end up as the exact same
 * `string[][]` (header + data rows) shape, so both apply the exact same
 * column-selection/row-range/CSV-serialization rule. */
export function extractTableSegment(fileName: string, rows: string[][], config: AgenticIngestionConfig): AgenticExtractedSegment {
  if (rows.length === 0) {
    return { fileName, text: '', truncated: false };
  }
  const [header, ...dataRows] = rows;

  let columnIndexes = header.map((_, i) => i);
  if (config.columns && config.columns.length > 0) {
    const wanted = new Set(config.columns);
    // A configured column name that no longer exists in the file (e.g. the
    // config was written against an earlier version of this file) is simply
    // dropped, never an error — ingestion always degrades gracefully.
    columnIndexes = header.map((_, i) => i).filter((i) => wanted.has(header[i]));
  }

  const selectedRows = sliceRange(dataRows, config.rowRange);
  const project = (row: string[]) => columnIndexes.map((i) => row[i] ?? '');
  const outputRows = [project(header), ...selectedRows.map(project)];

  return capSegment(fileName, stringifyCsv(outputRows).trimEnd());
}
