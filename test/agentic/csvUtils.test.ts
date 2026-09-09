import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { csvEscapeField, parseCsv, stringifyCsv } from '../../src/agentic/csvUtils';

test('parseCsv splits a simple comma-separated file into rows of cells', () => {
  const rows = parseCsv('Summary,Step #,Expected Result\nLogin,1,User is logged in\n');
  assert.deepEqual(rows, [
    ['Summary', 'Step #', 'Expected Result'],
    ['Login', '1', 'User is logged in']
  ]);
});

test('parseCsv keeps a comma inside a quoted field intact', () => {
  const rows = parseCsv('Summary,Description\n"Login, then logout",Two step flow\n');
  assert.deepEqual(rows, [
    ['Summary', 'Description'],
    ['Login, then logout', 'Two step flow']
  ]);
});

test('parseCsv unescapes a doubled quote inside a quoted field to a single literal quote', () => {
  const rows = parseCsv('Field\n"She said ""hi"""\n');
  assert.deepEqual(rows, [['Field'], ['She said "hi"']]);
});

test('parseCsv keeps an embedded newline inside a quoted field as part of that one cell', () => {
  const rows = parseCsv('Field\n"line one\nline two"\nafter\n');
  assert.deepEqual(rows, [['Field'], ['line one\nline two'], ['after']]);
});

test('parseCsv treats CRLF and bare LF line endings the same way', () => {
  const crlf = parseCsv('a,b\r\n1,2\r\n');
  const lf = parseCsv('a,b\n1,2\n');
  assert.deepEqual(crlf, lf);
});

test('parseCsv does not produce a phantom trailing empty row for a file ending in a newline', () => {
  const rows = parseCsv('a,b\n1,2\n');
  assert.equal(rows.length, 2);
});

test('parseCsv pads a short row out to the widest row\'s column count', () => {
  const rows = parseCsv('a,b,c\n1,2\n');
  assert.deepEqual(rows[1], ['1', '2', '']);
});

test('parseCsv on an empty string yields no rows', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('csvEscapeField only quotes a field that actually needs it', () => {
  assert.equal(csvEscapeField('plain'), 'plain');
  assert.equal(csvEscapeField('has,comma'), '"has,comma"');
  assert.equal(csvEscapeField('has"quote'), '"has""quote"');
  assert.equal(csvEscapeField('has\nnewline'), '"has\nnewline"');
});

test('stringifyCsv and parseCsv round-trip a table containing tricky fields', () => {
  const original = [
    ['Summary', 'Description', 'Step #'],
    ['Login, then search', 'Verifies "quoted" search terms\nacross two lines', '1']
  ];
  const csvText = stringifyCsv(original);
  const reparsed = parseCsv(csvText);
  assert.deepEqual(reparsed, original);
});

test('stringifyCsv uses CRLF line endings', () => {
  const csvText = stringifyCsv([['a', 'b'], ['1', '2']]);
  assert.ok(csvText.includes('a,b\r\n1,2\r\n'));
});
