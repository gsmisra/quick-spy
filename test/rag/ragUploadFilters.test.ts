import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isNoiseDirectoryPath, isSupportedRagSourceFile } from '../../src/rag/ragUploadFilters';

test('isSupportedRagSourceFile accepts common source/config extensions', () => {
  assert.ok(isSupportedRagSourceFile('PostgresHelper.java'));
  assert.ok(isSupportedRagSourceFile('db_helper.py'));
  assert.ok(isSupportedRagSourceFile('build.gradle'));
  assert.ok(isSupportedRagSourceFile('settings.yml'));
});

test('isSupportedRagSourceFile rejects extensions outside the allowlist', () => {
  assert.equal(isSupportedRagSourceFile('logo.png'), false);
  assert.equal(isSupportedRagSourceFile('archive.jar'), false);
  assert.equal(isSupportedRagSourceFile('compiled.class'), false);
  assert.equal(isSupportedRagSourceFile('no-extension'), false);
});

test('isSupportedRagSourceFile is case-insensitive on the extension', () => {
  assert.ok(isSupportedRagSourceFile('Helper.JAVA'));
});

test('isNoiseDirectoryPath flags a path with a known noise segment at any depth', () => {
  assert.ok(isNoiseDirectoryPath('node_modules'));
  assert.ok(isNoiseDirectoryPath('frontend/node_modules/react'));
  assert.ok(isNoiseDirectoryPath('backend/target/classes'));
  assert.ok(isNoiseDirectoryPath('.git/hooks'));
});

test('isNoiseDirectoryPath is case-insensitive', () => {
  assert.ok(isNoiseDirectoryPath('Backend/Target/classes'));
});

test('isNoiseDirectoryPath returns false for a legitimate source path', () => {
  assert.equal(isNoiseDirectoryPath('src/main/java/com/acme'), false);
  assert.equal(isNoiseDirectoryPath(''), false);
});
