import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { InvalidTestCaseCsvError, normalizeTestCaseCsvResponse } from '../../src/agentic/csvTestCaseGenerator';

const WELL_FORMED = 'Summary,Step #,Step Explanation,Expected Result\nLogin,1,Enter valid credentials,User is logged in\nLogin,2,Click Submit,Dashboard is shown\n';

test('accepts a well-formed CSV response and re-serializes it', () => {
  const result = normalizeTestCaseCsvResponse(WELL_FORMED);
  assert.equal(result.rowCount, 2);
  assert.equal(result.columnCount, 4);
  assert.ok(result.content.startsWith('Summary,Step #,Step Explanation,Expected Result\r\n'));
});

test('strips a single outer fence the model added despite instructions not to', () => {
  const wrapped = '```csv\n' + WELL_FORMED + '```';
  const result = normalizeTestCaseCsvResponse(wrapped);
  assert.equal(result.rowCount, 2);
});

test('drops a blank trailing line rather than counting it as a data row', () => {
  const withTrailingBlank = WELL_FORMED + '\n\n';
  const result = normalizeTestCaseCsvResponse(withTrailingBlank);
  assert.equal(result.rowCount, 2);
});

test('throws InvalidTestCaseCsvError for a response with no parseable content', () => {
  assert.throws(() => normalizeTestCaseCsvResponse('   \n  \n'), InvalidTestCaseCsvError);
});

test('throws InvalidTestCaseCsvError for prose with no CSV structure at all', () => {
  assert.throws(() => normalizeTestCaseCsvResponse('Sorry, I cannot generate test cases for this request.'), InvalidTestCaseCsvError);
});

test('round-trips a cell containing a comma and an embedded quote correctly', () => {
  const raw = 'Summary,Description\n"Login, then logout","She said ""hi"" first"\n';
  const result = normalizeTestCaseCsvResponse(raw);
  assert.ok(result.content.includes('"Login, then logout"'));
  assert.ok(result.content.includes('"She said ""hi"" first"'));
});
