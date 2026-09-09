import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildPdfPreview, extractPdfSegment, parsePdfBuffer } from '../../src/agentic/pdfIngestion';
import { AgenticPdfData } from '../../src/agentic/agenticTypes';

/**
 * A minimal, hand-built, uncompressed multi-page PDF — the same "build a
 * real artifact by hand and round-trip it through the real library"
 * approach test/rag/zipReader.test.ts uses for zip. Deliberately not using
 * a checked-in binary fixture file: this keeps the test self-contained and
 * exercises the exact byte-level structure (xref table, object offsets)
 * pdf.js actually parses.
 */
function buildPdfFixture(pagesText: string[]): Buffer {
  const objs: string[] = [];
  const kids = pagesText.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pagesText.length} >>\nendobj\n`);

  let objNum = 3;
  const fontObjNum = 3 + pagesText.length * 2;
  pagesText.forEach((text) => {
    const pageNum = objNum;
    const contentNum = objNum + 1;
    const content = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()]/g, '')}) Tj ET`;
    objs.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    );
    objs.push(`${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    objNum += 2;
  });
  objs.push(`${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body);
  const totalObjs = objs.length + 1;
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjs; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

test('parsePdfBuffer extracts text from every page, in order', async () => {
  const buffer = buildPdfFixture(['Hello World Page One', 'Second Page Content Here']);
  const data = await parsePdfBuffer(buffer);
  assert.equal(data.pages.length, 2);
  assert.match(data.pages[0], /Hello World Page One/);
  assert.match(data.pages[1], /Second Page Content Here/);
});

test('parsePdfBuffer handles a single-page document', async () => {
  const buffer = buildPdfFixture(['Only Page']);
  const data = await parsePdfBuffer(buffer);
  assert.equal(data.pages.length, 1);
  assert.match(data.pages[0], /Only Page/);
});

test('buildPdfPreview reports the total page count', async () => {
  const buffer = buildPdfFixture(['A', 'B', 'C']);
  const data = await parsePdfBuffer(buffer);
  assert.deepEqual(buildPdfPreview(data), { pageCount: 3 });
});

const FIVE_PAGE_DOC: AgenticPdfData = {
  pages: ['Page one text', 'Page two text', 'Page three text', 'Page four text', 'Page five text']
};

test('extractPdfSegment with no pageRange sends every page', () => {
  const segment = extractPdfSegment('doc.pdf', FIVE_PAGE_DOC, {});
  for (let i = 1; i <= 5; i++) {
    assert.match(segment.text, new RegExp(`--- Page ${i} ---`));
  }
});

test('extractPdfSegment restricts to the configured 1-based page range and labels pages correctly', () => {
  const segment = extractPdfSegment('doc.pdf', FIVE_PAGE_DOC, { pageRange: { from: 2, to: 3 } });
  assert.doesNotMatch(segment.text, /--- Page 1 ---/);
  assert.match(segment.text, /--- Page 2 ---\nPage two text/);
  assert.match(segment.text, /--- Page 3 ---\nPage three text/);
  assert.doesNotMatch(segment.text, /--- Page 4 ---/);
});

test('extractPdfSegment clamps an out-of-range "from" to page 1 for both the selection and the label', () => {
  const segment = extractPdfSegment('doc.pdf', FIVE_PAGE_DOC, { pageRange: { from: -5, to: 1 } });
  assert.match(segment.text, /--- Page 1 ---\nPage one text/);
});
