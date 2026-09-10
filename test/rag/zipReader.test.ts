import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { deflateRawSync } from 'zlib';
import { unzip, readZipDirectory, extractZipEntryContent, ZipEntryTooLargeError } from '../../src/rag/zipReader';

/**
 * Minimal, test-only ZIP writer — hand-builds a valid zip byte layout
 * (local file headers + central directory + end-of-central-directory
 * record) so `unzip()` can be exercised against real, correctly-encoded
 * zip bytes without needing an external zip tool or fixture file.
 */
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function buildZip(files: { path: string; content: string; store?: boolean }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path, 'utf-8');
    const contentBuf = Buffer.from(file.content, 'utf-8');
    const method = file.store ? 0 : 8;
    const data = file.store ? contentBuf : deflateRawSync(contentBuf);
    const crc = crc32(contentBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(contentBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(contentBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

test('extracts a single stored (uncompressed) entry with its exact content', () => {
  const zip = buildZip([{ path: 'hello.txt', content: 'hello world', store: true }]);
  const entries = unzip(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'hello.txt');
  assert.equal(entries[0].isDirectory, false);
  assert.equal(entries[0].content.toString('utf-8'), 'hello world');
});

test('extracts a deflated entry and inflates it back to the exact original content', () => {
  const content = 'public class Foo { void bar() { return; } }'.repeat(50);
  const zip = buildZip([{ path: 'src/Foo.java', content }]);
  const entries = unzip(zip);
  assert.equal(entries[0].content.toString('utf-8'), content);
});

test('preserves nested folder paths across multiple entries', () => {
  const zip = buildZip([
    { path: 'src/main/java/com/acme/Db.java', content: 'class Db {}' },
    { path: 'src/main/python/db.py', content: 'class Db: pass' }
  ]);
  const entries = unzip(zip);
  const paths = entries.map((e) => e.path).sort();
  assert.deepEqual(paths, ['src/main/java/com/acme/Db.java', 'src/main/python/db.py']);
});

test('a directory entry (trailing slash) is reported as isDirectory with no content', () => {
  const zip = buildZip([{ path: 'empty-folder/', content: '', store: true }]);
  const entries = unzip(zip);
  assert.equal(entries[0].isDirectory, true);
  assert.equal(entries[0].content.length, 0);
});

test('throws a clear error for a buffer that is not a zip file at all', () => {
  const notAZip = Buffer.from('just some plain text, definitely not a zip file', 'utf-8');
  assert.throws(() => unzip(notAZip), /not a valid zip/i);
});

test('rejects an unsupported compression method rather than returning garbage', () => {
  const zip = buildZip([{ path: 'weird.bin', content: 'data', store: true }]);
  // Method field lives at offset 8 within the local header and offset 10
  // within the central directory header (both start at offset 0 and the
  // central header signature since this zip has exactly one entry) — flip
  // both to an unsupported method (99) to exercise the guard.
  zip.writeUInt16LE(99, 8);
  const centralHeaderOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt16LE(99, centralHeaderOffset + 10);
  assert.throws(() => unzip(zip), /unsupported zip compression method/i);
});

test('readZipDirectory reads declared metadata for every entry WITHOUT decompressing any of them', () => {
  // Highly compressible on purpose — a small, deliberately BOUNDED fixture
  // (200KB, not a real multi-gigabyte zip bomb) standing in for "an entry
  // that inflates to far more than its compressed size suggests". Reading
  // the directory must never touch the actual (de)compression path at all.
  const bigContent = 'a'.repeat(200_000);
  const zip = buildZip([{ path: 'huge.txt', content: bigContent }]);
  const directory = readZipDirectory(zip);
  assert.equal(directory.length, 1);
  assert.equal(directory[0].path, 'huge.txt');
  assert.equal(directory[0].isDirectory, false);
  assert.equal(directory[0].uncompressedSize, 200_000);
  assert.ok(directory[0].compressedSize < 1_000, 'expected this highly-compressible fixture to compress to well under 1KB');
});

test('extractZipEntryContent rejects an entry whose ACTUAL decompressed output exceeds maxOutputBytes, bounded during inflate itself', () => {
  const bigContent = 'a'.repeat(200_000); // small, bounded fixture — see the test above
  const zip = buildZip([{ path: 'huge.txt', content: bigContent }]);
  const [entry] = readZipDirectory(zip);
  assert.throws(() => extractZipEntryContent(zip, entry, { maxOutputBytes: 10_000 }), ZipEntryTooLargeError);
});

test('extractZipEntryContent rejects an oversized STORED (uncompressed) entry too, not just deflated ones', () => {
  const zip = buildZip([{ path: 'huge.txt', content: 'a'.repeat(50_000), store: true }]);
  const [entry] = readZipDirectory(zip);
  assert.throws(() => extractZipEntryContent(zip, entry, { maxOutputBytes: 10_000 }), ZipEntryTooLargeError);
});

test('extractZipEntryContent succeeds and returns exact content when it fits within maxOutputBytes', () => {
  const content = 'hello world';
  const zip = buildZip([{ path: 'small.txt', content }]);
  const [entry] = readZipDirectory(zip);
  const result = extractZipEntryContent(zip, entry, { maxOutputBytes: 1_000 });
  assert.equal(result.toString('utf-8'), content);
});

test('extractZipEntryContent on a directory entry returns empty content without touching maxOutputBytes at all', () => {
  const zip = buildZip([{ path: 'empty-folder/', content: '', store: true }]);
  const [entry] = readZipDirectory(zip);
  const result = extractZipEntryContent(zip, entry, { maxOutputBytes: 0 });
  assert.equal(result.length, 0);
});

test('readZipDirectory throws a clear error when an entry\'s local header offset points outside the file', () => {
  const zip = buildZip([{ path: 'a.txt', content: 'hi', store: true }]);
  const centralHeaderOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(zip.length + 1_000, centralHeaderOffset + 42); // local-header-offset field
  assert.throws(() => readZipDirectory(zip), /local file header offset outside the file/i);
});

test('extractZipEntryContent throws a clear error when the declared compressed size extends past the end of the file', () => {
  const zip = buildZip([{ path: 'a.txt', content: 'hi', store: true }]);
  const centralHeaderOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(1_000_000, centralHeaderOffset + 20); // compressed-size field
  const [entry] = readZipDirectory(zip);
  assert.throws(() => extractZipEntryContent(zip, entry, { maxOutputBytes: 10_000_000 }), /extends past the end of the file/i);
});

test('unzip() (the no-cap convenience wrapper) still round-trips exactly like before this fix for ordinary archives', () => {
  const zip = buildZip([
    { path: 'a.txt', content: 'stored content', store: true },
    { path: 'b.txt', content: 'deflated content, repeated a bit to compress well. '.repeat(10) }
  ]);
  const entries = unzip(zip);
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e.content.toString('utf-8')]));
  assert.equal(byPath['a.txt'], 'stored content');
  assert.equal(byPath['b.txt'], 'deflated content, repeated a bit to compress well. '.repeat(10));
});

test('extracts multiple entries with a mix of stored and deflated compression', () => {
  const zip = buildZip([
    { path: 'a.txt', content: 'stored content', store: true },
    { path: 'b.txt', content: 'deflated content, repeated a bit to compress well. '.repeat(10) }
  ]);
  const entries = unzip(zip);
  const byPath = Object.fromEntries(entries.map((e) => [e.path, e.content.toString('utf-8')]));
  assert.equal(byPath['a.txt'], 'stored content');
  assert.equal(byPath['b.txt'], 'deflated content, repeated a bit to compress well. '.repeat(10));
});
