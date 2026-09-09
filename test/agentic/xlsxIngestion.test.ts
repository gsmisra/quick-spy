import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildXlsxPreview, extractXlsxSegment, parseXlsxBuffer } from '../../src/agentic/xlsxIngestion';
import { AgenticXlsxData } from '../../src/agentic/agenticTypes';

/** Builds a real .xlsx buffer with exceljs's OWN writer — round-tripping
 * through the real library (rather than a hand-built fixture) is exactly
 * what makes this an end-to-end test of parseXlsxBuffer(), the same
 * "build a real artifact with the library's own writer" approach
 * test/rag/zipReader.test.ts and test/agentic/pdfIngestion.test.ts use. */
async function buildXlsxFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const usersSheet = workbook.addWorksheet('Users');
  usersSheet.addRow(['Name', 'Role', 'Active']);
  usersSheet.addRow(['Alice', 'Admin', 'true']);
  usersSheet.addRow(['Bob', 'Viewer', 'false']);
  usersSheet.addRow(['Carol', 'Editor', 'true']);

  const emptySheet = workbook.addWorksheet('Empty');
  void emptySheet;

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

test('parseXlsxBuffer reads every sheet, including an empty one', async () => {
  const buffer = await buildXlsxFixture();
  const data = await parseXlsxBuffer(buffer);
  assert.equal(data.sheets.length, 2);
  assert.equal(data.sheets[0].name, 'Users');
  assert.equal(data.sheets[1].name, 'Empty');
  assert.equal(data.sheets[1].rows.length, 0);
});

test('parseXlsxBuffer reads real cell text for every row and column', async () => {
  const buffer = await buildXlsxFixture();
  const data = await parseXlsxBuffer(buffer);
  assert.deepEqual(data.sheets[0].rows, [
    ['Name', 'Role', 'Active'],
    ['Alice', 'Admin', 'true'],
    ['Bob', 'Viewer', 'false'],
    ['Carol', 'Editor', 'true']
  ]);
});

test('buildXlsxPreview reports headers and data-row count per sheet', async () => {
  const buffer = await buildXlsxFixture();
  const data = await parseXlsxBuffer(buffer);
  const preview = buildXlsxPreview(data);
  assert.deepEqual(preview, {
    sheets: [
      { name: 'Users', headers: ['Name', 'Role', 'Active'], dataRowCount: 3 },
      { name: 'Empty', headers: [], dataRowCount: 0 }
    ]
  });
});

const SAMPLE_DATA: AgenticXlsxData = {
  sheets: [
    {
      name: 'Users',
      rows: [
        ['Name', 'Role', 'Active'],
        ['Alice', 'Admin', 'true'],
        ['Bob', 'Viewer', 'false'],
        ['Carol', 'Editor', 'true']
      ]
    },
    { name: 'Other', rows: [['A', 'B'], ['1', '2']] }
  ]
};

test('extractXlsxSegment defaults to the FIRST sheet when no sheetName is configured', () => {
  const segment = extractXlsxSegment('workbook.xlsx', SAMPLE_DATA, {});
  assert.match(segment.text, /Alice/);
  assert.doesNotMatch(segment.text, /^A,B/m);
});

test('extractXlsxSegment respects a configured sheetName', () => {
  const segment = extractXlsxSegment('workbook.xlsx', SAMPLE_DATA, { sheetName: 'Other' });
  assert.equal(segment.text, 'A,B\r\n1,2');
});

test('extractXlsxSegment falls back to the first sheet for an unknown sheetName rather than erroring', () => {
  const segment = extractXlsxSegment('workbook.xlsx', SAMPLE_DATA, { sheetName: 'DoesNotExist' });
  assert.match(segment.text, /Alice/);
});

test('extractXlsxSegment applies row range and column selection on the chosen sheet', () => {
  const segment = extractXlsxSegment('workbook.xlsx', SAMPLE_DATA, {
    sheetName: 'Users',
    rowRange: { from: 1, to: 2 },
    columns: ['Name', 'Active']
  });
  assert.equal(segment.text, 'Name,Active\r\nAlice,true\r\nBob,false');
});

test('extractXlsxSegment returns empty for a workbook with no sheets', () => {
  const segment = extractXlsxSegment('empty.xlsx', { sheets: [] }, {});
  assert.equal(segment.text, '');
  assert.equal(segment.truncated, false);
});
