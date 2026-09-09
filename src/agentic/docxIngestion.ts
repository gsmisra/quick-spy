import * as mammoth from 'mammoth';
import { capSegment, sliceRange } from './agenticExtractionUtils';
import { AgenticDocxData, AgenticDocxSection, AgenticExtractedSegment, AgenticFileMeta, AgenticIngestionConfig } from './agenticTypes';

/**
 * Phase 2 — `.docx` ingestion. `parseDocxBuffer()` is the only part of this
 * file that actually touches the `mammoth` library (thin, reviewed rather
 * than unit tested directly — a real .docx zip package only makes sense to
 * parse with the real library); `splitMarkdownIntoSections()` (the actual
 * heading-detection logic) and `extractDocxSegment()`/`buildDocxPreview()`
 * are pure functions unit tested directly with plain markdown/section
 * fixtures — see test/agentic/docxIngestion.test.ts.
 *
 * Why headings, not "pages": a .docx file stores paragraphs/headings/
 * sections in its XML; page breaks are a RENDERING-time outcome of
 * margins/fonts/printer settings, never stored data — there is no reliable
 * "page 3" to extract the way there is for a PDF (which does store real
 * page boundaries — see pdfIngestion.ts) or a spreadsheet row. A heading
 * range is the closest meaningful equivalent: it lets a user narrow to
 * "the Login Flow section through the Checkout section" the way they'd
 * actually navigate a requirements document.
 *
 * mammoth's `convertToMarkdown()` (not `convertToHtml()`) is used
 * specifically because it renders Word's built-in Heading 1-6 styles as
 * plain ATX markdown headings (`#` through `######`), which
 * `splitMarkdownIntoSections()` can then split on with a simple, robust
 * line-based scan — no HTML tag parsing needed.
 */

const ATX_HEADING = /^(#{1,6})\s+(.*)$/;

/** Splits mammoth's markdown output into one section per heading (any
 * level) — `text` for each section is everything up to (not including)
 * the NEXT heading at any level, or the end of the document for the last
 * one. A document with no headings at all becomes a single section with
 * `heading: ''`, `level: 0`, holding the entire text — so "narrow by
 * heading" always degrades to "the whole document" rather than losing
 * content for a document that just doesn't use Word's heading styles. */
export function splitMarkdownIntoSections(markdown: string): AgenticDocxSection[] {
  const lines = markdown.split(/\r\n|\r|\n/);
  const sections: AgenticDocxSection[] = [];
  let current: AgenticDocxSection = { heading: '', level: 0, text: '' };
  let bodyLines: string[] = [];

  for (const line of lines) {
    const match = line.match(ATX_HEADING);
    if (match) {
      current.text = bodyLines.join('\n').trim();
      sections.push(current);
      bodyLines = [];
      current = { heading: match[2].trim(), level: match[1].length, text: '' };
      continue;
    }
    bodyLines.push(line);
  }
  current.text = bodyLines.join('\n').trim();
  sections.push(current);

  // Drop the implicit leading "preamble" section when it turned out to be
  // both heading-less AND empty (a document that starts directly with a
  // heading, the common case) — but keep a genuinely non-empty preamble
  // (text before the first heading) as its own heading-less section.
  return sections.filter((s) => s.heading || s.text);
}

export async function parseDocxBuffer(buffer: Buffer): Promise<AgenticDocxData> {
  const result = await mammoth.convertToMarkdown({ buffer });
  return { sections: splitMarkdownIntoSections(result.value) };
}

export function buildDocxPreview(data: AgenticDocxData): AgenticFileMeta['docxPreview'] {
  return { headings: data.sections.filter((s) => s.heading).map((s) => ({ text: s.heading, level: s.level })) };
}

/** Selects the sections whose HEADING falls within `config.headingRange`'s
 * 1-based index range, counted over sections that actually have a heading
 * (a document with no headings — `headingRange` is meaningless then —
 * always returns the whole thing). Re-renders each kept section back to a
 * clearly-labeled markdown block, so the LLM still sees which heading each
 * piece of text came from. */
export function extractDocxSegment(fileName: string, data: AgenticDocxData, config: AgenticIngestionConfig): AgenticExtractedSegment {
  const headedSections = data.sections.filter((s) => s.heading);
  if (headedSections.length === 0 || !config.headingRange) {
    const fullText = data.sections.map((s) => (s.heading ? `${'#'.repeat(s.level)} ${s.heading}\n${s.text}` : s.text)).join('\n\n');
    return capSegment(fileName, fullText.trim());
  }

  const selected = sliceRange(
    headedSections,
    { from: config.headingRange.fromIndex, to: config.headingRange.toIndex }
  );
  const text = selected.map((s) => `${'#'.repeat(s.level)} ${s.heading}\n${s.text}`).join('\n\n');
  return capSegment(fileName, text.trim());
}
