import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildCsvPreview, detectAgenticFileKind, extractAgenticSegment } from '../../src/agentic/textIngestion';
import { AGENTIC_MAX_SEGMENT_CHARS } from '../../src/agentic/agenticTypes';

test('detectAgenticFileKind recognizes every Phase 1 structured extension', () => {
  assert.equal(detectAgenticFileKind('data.csv'), 'csv');
  assert.equal(detectAgenticFileKind('config.JSON'), 'json');
  assert.equal(detectAgenticFileKind('requirements.xml'), 'xml');
  assert.equal(detectAgenticFileKind('settings.yaml'), 'yaml');
  assert.equal(detectAgenticFileKind('settings.yml'), 'yaml');
  assert.equal(detectAgenticFileKind('notes.txt'), 'text');
});

test('detectAgenticFileKind falls back to "text" for an unrecognized extension rather than rejecting it', () => {
  assert.equal(detectAgenticFileKind('weird.foobar'), 'text');
  assert.equal(detectAgenticFileKind('no-extension-at-all'), 'text');
});

test('extractAgenticSegment with no config returns the whole file for a text-like kind', () => {
  const segment = extractAgenticSegment('notes.txt', 'text', 'line one\nline two\nline three', {});
  assert.equal(segment.text, 'line one\nline two\nline three');
  assert.equal(segment.truncated, false);
});

test('extractAgenticSegment applies a 1-based inclusive line range', () => {
  const raw = 'line1\nline2\nline3\nline4\nline5';
  const segment = extractAgenticSegment('notes.txt', 'text', raw, { lineRange: { from: 2, to: 4 } });
  assert.equal(segment.text, 'line2\nline3\nline4');
});

test('extractAgenticSegment line range tolerates an open-ended from/to', () => {
  const raw = 'line1\nline2\nline3';
  assert.equal(extractAgenticSegment('n.txt', 'text', raw, { lineRange: { from: 2 } }).text, 'line2\nline3');
  assert.equal(extractAgenticSegment('n.txt', 'text', raw, { lineRange: { to: 2 } }).text, 'line1\nline2');
});

test('extractAgenticSegment truncates to the hard char cap and flags it', () => {
  const raw = 'x'.repeat(AGENTIC_MAX_SEGMENT_CHARS + 500);
  const segment = extractAgenticSegment('big.txt', 'text', raw, {});
  assert.equal(segment.text.length, AGENTIC_MAX_SEGMENT_CHARS);
  assert.equal(segment.truncated, true);
});

test('extractAgenticSegment for csv keeps the header row and applies the configured row range to data rows only', () => {
  const raw = 'Name,Value\nA,1\nB,2\nC,3\nD,4';
  const segment = extractAgenticSegment('data.csv', 'csv', raw, { rowRange: { from: 2, to: 3 } });
  assert.equal(segment.text, 'Name,Value\r\nB,2\r\nC,3');
});

test('extractAgenticSegment for csv restricts to the configured columns, preserving header order', () => {
  const raw = 'Name,Value,Notes\nA,1,x\nB,2,y';
  const segment = extractAgenticSegment('data.csv', 'csv', raw, { columns: ['Notes', 'Name'] });
  // Column order follows the ORIGINAL header order, not the config's order —
  // predictable and matches how the source file itself is structured.
  assert.equal(segment.text, 'Name,Notes\r\nA,x\r\nB,y');
});

test('extractAgenticSegment for csv ignores a configured column that no longer exists rather than erroring', () => {
  const raw = 'Name,Value\nA,1';
  const segment = extractAgenticSegment('data.csv', 'csv', raw, { columns: ['Name', 'DoesNotExist'] });
  assert.equal(segment.text, 'Name\r\nA');
});

test('extractAgenticSegment for csv with no config at all returns every column and every row', () => {
  const raw = 'Name,Value\nA,1\nB,2';
  const segment = extractAgenticSegment('data.csv', 'csv', raw, {});
  assert.equal(segment.text, 'Name,Value\r\nA,1\r\nB,2');
});

test('buildCsvPreview reports the header and the DATA row count (excluding the header itself)', () => {
  const preview = buildCsvPreview('Name,Value\nA,1\nB,2\nC,3');
  assert.deepEqual(preview, { headers: ['Name', 'Value'], dataRowCount: 3 });
});

test('buildCsvPreview returns undefined for a completely empty file', () => {
  assert.equal(buildCsvPreview(''), undefined);
});
