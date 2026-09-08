import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseRagFile, serializeRagFile } from '../../src/rag/ragFrontmatter';

const VALID_FILE = `---
id: postgres-query-and-validate
title: Query a Postgres table and validate a result
tags: [postgres, database, sql]
automationMode: [api, ui]
language: [java, python]
imports:
  java: [com.acme.testutil.db.PostgresHelper]
  python: [testutil.db.postgres_helper]
---

Connects via the shared PostgresHelper and runs a parameterized query.

\`\`\`java
var row = PostgresHelper.queryOne(conn, "SELECT status FROM orders WHERE id = ?", orderId);
\`\`\`
`;

test('parses a well-formed recipe file into frontmatter + trimmed body', () => {
  const result = parseRagFile(VALID_FILE);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.frontmatter.id, 'postgres-query-and-validate');
  assert.deepEqual(result.value.frontmatter.tags, ['postgres', 'database', 'sql']);
  assert.deepEqual(result.value.frontmatter.automationMode, ['api', 'ui']);
  assert.deepEqual(result.value.frontmatter.imports?.java, ['com.acme.testutil.db.PostgresHelper']);
  assert.ok(result.value.body.startsWith('Connects via'));
  assert.ok(result.value.body.includes('PostgresHelper.queryOne'));
});

test('strips a leading BOM before checking for frontmatter', () => {
  const result = parseRagFile('﻿' + VALID_FILE);
  assert.equal(result.ok, true);
});

test('rejects a file with no frontmatter at all', () => {
  const result = parseRagFile('# Just a heading\n\nSome code here.\n');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /Missing YAML frontmatter/);
});

test('rejects a file whose frontmatter is never closed', () => {
  const result = parseRagFile('---\nid: foo\ntitle: Foo\n\nBody text with no closing fence.\n');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /never closed/);
});

test('rejects invalid YAML in the frontmatter block', () => {
  const result = parseRagFile('---\nid: [unclosed\n---\nBody\n');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /not valid YAML/);
});

test('rejects frontmatter missing required fields', () => {
  const result = parseRagFile('---\ntitle: Missing an id\nautomationMode: [ui]\nlanguage: [java]\n---\nBody\n');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /failed validation/);
});

test('rejects an id that is not lowercase kebab-case', () => {
  const result = parseRagFile('---\nid: Not_Valid ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\nBody\n');
  assert.equal(result.ok, false);
});

test('rejects an unrecognized automationMode/language value', () => {
  const result = parseRagFile('---\nid: x\ntitle: X\nautomationMode: [desktop]\nlanguage: [java]\n---\nBody\n');
  assert.equal(result.ok, false);
});

test('defaults tags to an empty array when omitted', () => {
  const result = parseRagFile('---\nid: x\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\nBody\n');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.frontmatter.tags, []);
});

test('serializeRagFile output round-trips through parseRagFile unchanged', () => {
  const original = parseRagFile(VALID_FILE);
  assert.equal(original.ok, true);
  if (!original.ok) return;

  const serialized = serializeRagFile(original.value.frontmatter, original.value.body);
  const reparsed = parseRagFile(serialized);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;

  assert.deepEqual(reparsed.value.frontmatter, original.value.frontmatter);
  assert.equal(reparsed.value.body, original.value.body);
});
