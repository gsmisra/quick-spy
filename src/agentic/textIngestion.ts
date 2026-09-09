import * as path from 'path';
import { parseCsv } from './csvUtils';
import { capSegment, extractTableSegment, sliceRange } from './agenticExtractionUtils';
import {
  AGENTIC_STRUCTURED_EXTENSIONS,
  AgenticExtractedSegment,
  AgenticFileKind,
  AgenticIngestedFile,
  AgenticIngestionConfig
} from './agenticTypes';
import { extractXlsxSegment } from './xlsxIngestion';
import { extractDocxSegment } from './docxIngestion';
import { extractPdfSegment } from './pdfIngestion';

/**
 * Pure ingestion logic for Total Agentic Mode — given a file's already-
 * parsed content and the user's `AgenticIngestionConfig` (Ingestion
 * Configuration panel, agenticIngestionPanel.ts), decides exactly what
 * text for that file actually reaches the LLM's context. Zero `vscode`
 * import, directly unit-testable; the vscode-glue orchestration (reading
 * the dropped file, calling the actual xlsx/docx/pdf parser libraries,
 * caching the result in memory, wiring it into a prompt alongside RAG/
 * custom-instructions/chat-box context) lives in agenticModeController.ts.
 *
 * csv/json/xml/yaml/text are handled directly here (they're all just
 * "slice some text"); `'xlsx'`/`'docx'`/`'pdf'` delegate to their own
 * dedicated pure extractors (xlsxIngestion.ts/docxIngestion.ts/
 * pdfIngestion.ts) since each needs its own already-parsed structure
 * (sheets/sections/pages), not raw text, to slice correctly. The actual
 * shared slicing/capping primitives live in agenticExtractionUtils.ts so
 * none of these format-specific modules import each other in a cycle.
 */

export function detectAgenticFileKind(fileName: string): AgenticFileKind {
  const ext = path.extname(fileName).toLowerCase();
  return AGENTIC_STRUCTURED_EXTENSIONS[ext] ?? 'text';
}

function extractCsvSegment(fileName: string, rawText: string, config: AgenticIngestionConfig): AgenticExtractedSegment {
  return extractTableSegment(fileName, parseCsv(rawText), config);
}

/** Line-range extraction for json/xml/yaml/text/md/log — deliberately the
 * SAME simple mechanism for all of them rather than a per-format parser
 * (a full JSON/XML/YAML parse-and-reserialize would risk silently
 * reformatting a user's file, or breaking on content that isn't
 * well-formed in the first place — e.g. a requirements doc with `<tag>`-
 * looking text that isn't actually XML). A line range is predictable,
 * always safe, and works identically no matter which of these formats the
 * file actually is. */
function extractLineRangeSegment(fileName: string, rawText: string, config: AgenticIngestionConfig): AgenticExtractedSegment {
  if (!config.lineRange) {
    return capSegment(fileName, rawText);
  }
  const lines = rawText.split(/\r\n|\r|\n/);
  const selected = sliceRange(lines, config.lineRange);
  return capSegment(fileName, selected.join('\n'));
}

/** The text-like-kind entry point (csv/json/xml/yaml/text) — kept as its
 * own function (rather than folded into `extractSegmentForFile()` below)
 * so a caller with only raw text in hand (no full `AgenticIngestedFile`)
 * can still use it directly; the test suite does. */
export function extractAgenticSegment(
  fileName: string,
  kind: AgenticFileKind,
  rawText: string,
  config: AgenticIngestionConfig
): AgenticExtractedSegment {
  if (kind === 'csv') {
    return extractCsvSegment(fileName, rawText, config);
  }
  return extractLineRangeSegment(fileName, rawText, config);
}

/** The ONE entry point agenticModeController.ts and agenticIngestionPanel.ts
 * actually call per ingested file — dispatches to the right extractor for
 * whichever kind this file is, text-like or not. */
export function extractSegmentForFile(file: AgenticIngestedFile): AgenticExtractedSegment {
  switch (file.kind) {
    case 'xlsx':
      return file.parsedXlsx
        ? extractXlsxSegment(file.fileName, file.parsedXlsx, file.config)
        : { fileName: file.fileName, text: '', truncated: false };
    case 'docx':
      return file.parsedDocx
        ? extractDocxSegment(file.fileName, file.parsedDocx, file.config)
        : { fileName: file.fileName, text: '', truncated: false };
    case 'pdf':
      return file.parsedPdf
        ? extractPdfSegment(file.fileName, file.parsedPdf, file.config)
        : { fileName: file.fileName, text: '', truncated: false };
    default:
      return extractAgenticSegment(file.fileName, file.kind, file.rawText, file.config);
  }
}

/** Builds the `csvPreview` metadata (header + data-row count) shown in the
 * Ingestion Configuration panel the moment a `.csv` is dropped, before any
 * config is applied — lets the panel render a real column checklist and a
 * real "rows 1-N of <total>" hint instead of guessing. Returns `undefined`
 * for a completely empty file (nothing to preview). */
export function buildCsvPreview(rawText: string): { headers: string[]; dataRowCount: number } | undefined {
  const rows = parseCsv(rawText);
  if (rows.length === 0) {
    return undefined;
  }
  const [header, ...dataRows] = rows;
  return { headers: header, dataRowCount: dataRows.length };
}
