import { capSegment, sliceRange } from './agenticExtractionUtils';
import { AgenticExtractedSegment, AgenticFileMeta, AgenticIngestionConfig, AgenticPdfData } from './agenticTypes';

/**
 * Phase 2 — `.pdf` ingestion. `parsePdfBuffer()` is the only part of this
 * file that actually touches `pdfjs-dist` (thin, reviewed rather than unit
 * tested directly); `extractPdfSegment()`/`buildPdfPreview()` are pure
 * functions over the ALREADY-PARSED `AgenticPdfData` (one string per page)
 * and are unit tested directly with hand-built page arrays — see
 * test/agentic/pdfIngestion.test.ts (which also builds a real, minimal,
 * hand-crafted multi-page PDF buffer to exercise `parsePdfBuffer()` itself
 * end-to-end, the same "build a real fixture in the test" approach
 * rag/zipReader.test.ts already uses for zip).
 *
 * Unlike `.docx` (see docxIngestion.ts's doc comment), a PDF genuinely
 * stores page boundaries as real document structure, so "select page 3-5"
 * is directly meaningful here — no heading-range workaround needed.
 *
 * `pdfjs-dist`'s only Node-compatible build (`legacy/build/pdf.mjs`) is
 * ESM-only (no CommonJS build, no package.json "exports" map) — loaded via
 * a dynamic `import()` (TypeScript preserves this as a real ES dynamic
 * import even under `module: "commonjs"`, the standard way to consume an
 * ESM-only package from CJS in Node) and left untyped (`any`) rather than
 * fighting `moduleResolution: "node"`'s lack of `.mjs`/`.d.mts`
 * co-resolution for one thin, reviewed integration point.
 */

let pdfjsLibPromise: Promise<any> | undefined;
function loadPdfjs(): Promise<any> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

export async function parsePdfBuffer(buffer: Buffer): Promise<AgenticPdfData> {
  const pdfjsLib = await loadPdfjs();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    // Quiets pdf.js's own non-fatal console warnings (missing embedded
    // font metrics, no canvas for rendering — irrelevant to pure text
    // extraction) so a routine ingestion doesn't spam the Extension Host's
    // console; a real structural error still throws and is reported.
    verbosity: 0
  }).promise;

  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // pdf.js splits a page's text into many small positioned fragments —
    // joined with no separator, matching the mechanical "glue the text
    // stream back together" nature of PDF text extraction; a fragment
    // ending mid-word is a rare, cosmetic artifact, not something worth a
    // heuristic that could just as easily insert a WRONG extra space.
    pages.push(content.items.map((item: { str?: string }) => item.str ?? '').join(''));
  }
  return { pages };
}

export function buildPdfPreview(data: AgenticPdfData): AgenticFileMeta['pdfPreview'] {
  return { pageCount: data.pages.length };
}

export function extractPdfSegment(fileName: string, data: AgenticPdfData, config: AgenticIngestionConfig): AgenticExtractedSegment {
  const selectedPages = sliceRange(data.pages, config.pageRange);
  // Mirrors sliceRange()'s own clamping exactly, so a page label here can
  // never disagree with which pages were actually selected (e.g. a
  // configured `from: 0` clamps to page 1 in both places, not just one).
  const firstSelectedPageNumber = Math.max(1, config.pageRange?.from ?? 1);
  const text = selectedPages
    .map((pageText, i) => `--- Page ${firstSelectedPageNumber + i} ---\n${pageText}`)
    .join('\n\n');
  return capSegment(fileName, text.trim());
}
