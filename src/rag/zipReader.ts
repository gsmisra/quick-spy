import { inflateRawSync } from 'zlib';

/**
 * A tiny, dependency-free ZIP reader — parses just enough of the ZIP
 * central-directory format (PKWARE's APPNOTE.TXT) to list and extract every
 * file entry from a project/framework archive dropped onto "Generate RAG
 * Corpus format" (see ragCorpusGenerator.ts, settingsPanel.ts), using only
 * Node's built-in `zlib.inflateRawSync` for the (near-universal) DEFLATE
 * method — no zip/unzip npm package, matching this extension's
 * dependency-free RAG posture (see tfidfEmbeddings.ts's own doc comment).
 *
 * Deliberately reads entry sizes/offsets from the CENTRAL directory, never
 * the local file header — the central directory is always authoritative
 * (unlike a local header written with a streaming "data descriptor", whose
 * own size fields can be zero), so this works correctly against a zip
 * produced by any standard tool (Windows Explorer, macOS Archive Utility,
 * the `zip` CLI, GitHub's own "Download ZIP").
 *
 * Deliberately split into two phases so a caller can apply its own
 * path/type/size POLICY (see settingsPanel.ts's `handleExpandRagZip`)
 * BEFORE any decompression happens, not after:
 *  1. `readZipDirectory()` — reads ONLY the central directory's metadata
 *     (path, declared sizes, compression method) for every entry. Zero
 *     decompression, so its cost is bounded purely by the already-loaded
 *     buffer's own size, however many entries it claims to have.
 *  2. `extractZipEntryContent()` — decompresses exactly ONE entry on
 *     demand, with a caller-supplied hard cap on decompressed OUTPUT size
 *     enforced by zlib itself (`maxOutputLength`) — not just checked after
 *     the fact — so a highly-compressible entry (a "zip bomb": kilobytes
 *     compressed, gigabytes decompressed) can never balloon memory past
 *     that cap regardless of what its own declared size claims.
 * `unzip()` is a convenience wrapper composing both phases with no size
 * cap, kept for callers (and tests) that just want everything, all at
 * once — production code that reads an ARBITRARY, possibly-untrusted
 * upload (settingsPanel.ts) uses the two-phase API directly instead, and
 * MUST apply its own bounds; see that file's own doc comments.
 *
 * Pure and synchronous, zero `vscode` import — directly unit-testable
 * against a hand-built in-memory zip buffer.
 */

export interface ZipEntry {
  /** Forward-slash-normalized path exactly as stored in the zip, e.g.
   * "src/main/java/com/acme/DbHelper.java". */
  path: string;
  isDirectory: boolean;
  content: Buffer;
}

/** One entry's metadata straight from the (authoritative) central
 * directory — available with ZERO decompression, so a caller can filter by
 * path/type/declared-size before ever paying for an inflate. A malicious or
 * corrupt archive can lie about `uncompressedSize`; it's a useful signal
 * for an upfront reject, but `extractZipEntryContent()`'s own
 * `maxOutputBytes` bound — enforced by zlib during decompression itself —
 * is what actually protects against that lie, not this number alone. */
export interface ZipDirectoryEntry {
  path: string;
  isDirectory: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ExtractZipEntryOptions {
  /** Hard cap on this ONE entry's decompressed output, enforced by zlib
   * itself while inflating (via `maxOutputLength`) — the moment the
   * decompressed stream would exceed it, inflation stops and throws,
   * rather than first fully inflating and only checking the size
   * afterward. Required — there is no unbounded default in this path;
   * `unzip()` below is the only caller that opts into "no cap". */
  maxOutputBytes: number;
}

/** Thrown by `extractZipEntryContent()` when an entry's compressed data (for
 * a stored/method-0 entry) or decompressed output (for a deflated entry,
 * enforced live by zlib) would exceed the caller's `maxOutputBytes` — OR
 * when the entry is simply corrupt in a way that surfaces the same way
 * (zlib can't always tell "hit the output cap" and "malformed deflate
 * stream" apart). Either way the safe, correct response is identical: skip
 * this one entry, never allocate unbounded memory for it. */
export class ZipEntryTooLargeError extends Error {
  constructor(
    public readonly entryPath: string,
    public readonly maxOutputBytes: number
  ) {
    super(`"${entryPath}" could not be safely extracted within the ${maxOutputBytes.toLocaleString()}-byte limit (too large, or corrupt).`);
    this.name = 'ZipEntryTooLargeError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
const CENTRAL_DIR_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;
const MAX_ZIP_COMMENT_SIZE = 65535;

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < EOCD_FIXED_SIZE) {
    throw new Error('Not a valid zip file — file is too small to contain an end-of-central-directory record.');
  }
  const searchFloor = Math.max(0, buffer.length - EOCD_FIXED_SIZE - MAX_ZIP_COMMENT_SIZE);
  for (let i = buffer.length - EOCD_FIXED_SIZE; i >= searchFloor; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  throw new Error('Not a valid zip file — end-of-central-directory record not found.');
}

/** Reads ONLY the central directory's per-entry metadata — no file data is
 * touched and nothing is decompressed, so this is safe to run against an
 * arbitrarily hostile buffer before deciding whether (and how) to extract
 * anything from it. Validates every offset/length it reads against the
 * buffer's actual size as it goes, throwing a clear error for anything that
 * would read past the end of the buffer, rather than letting a crafted
 * "declares more entries/bytes than actually exist" file trigger a raw,
 * cryptic `RangeError` deep inside a `Buffer.read*` call. */
export function readZipDirectory(buffer: Buffer): ZipDirectoryEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error(
      'This zip uses the ZIP64 format, which is not supported — try re-zipping without ZIP64 ' +
        '(most standard zip tools only use it for archives over 4GB).'
    );
  }
  if (centralDirOffset + centralDirSize > buffer.length) {
    throw new Error('Not a valid zip file — central directory extends past the end of the file.');
  }

  const entries: ZipDirectoryEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + CENTRAL_DIR_FIXED_SIZE > buffer.length) {
      throw new Error('Not a valid zip file — central directory record extends past the end of the file.');
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Not a valid zip file — malformed central directory record.');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    if (offset + CENTRAL_DIR_FIXED_SIZE + fileNameLength > buffer.length) {
      throw new Error('Not a valid zip file — a file name in the central directory extends past the end of the file.');
    }
    const fileName = buffer.toString('utf-8', offset + CENTRAL_DIR_FIXED_SIZE, offset + CENTRAL_DIR_FIXED_SIZE + fileNameLength);
    const normalizedPath = fileName.replace(/\\/g, '/');
    if (localHeaderOffset + LOCAL_HEADER_FIXED_SIZE > buffer.length) {
      throw new Error(`Not a valid zip file — "${fileName}" points at a local file header offset outside the file.`);
    }

    entries.push({
      path: normalizedPath,
      isDirectory: normalizedPath.endsWith('/'),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    offset += CENTRAL_DIR_FIXED_SIZE + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

/** Decompresses exactly ONE entry (previously read via `readZipDirectory()`)
 * against the same buffer, bounded by `options.maxOutputBytes`. Validates
 * the local file header and the compressed-data span against the buffer's
 * actual bounds before touching anything, and — for a deflated entry —
 * passes the cap straight to zlib's own `maxOutputLength`, so decompression
 * itself is stopped the instant it would exceed the cap rather than ever
 * fully materializing an oversized result first. */
export function extractZipEntryContent(buffer: Buffer, entry: ZipDirectoryEntry, options: ExtractZipEntryOptions): Buffer {
  if (entry.isDirectory) {
    return Buffer.alloc(0);
  }
  const { localHeaderOffset, compressionMethod, compressedSize, path: entryPath } = entry;
  if (localHeaderOffset + LOCAL_HEADER_FIXED_SIZE > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Not a valid zip file — malformed local file header for "${entryPath}".`);
  }
  const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + LOCAL_HEADER_FIXED_SIZE + localFileNameLength + localExtraFieldLength;
  if (compressedSize < 0 || dataStart + compressedSize > buffer.length) {
    throw new Error(`Not a valid zip file — "${entryPath}"'s compressed data extends past the end of the file.`);
  }
  const rawData = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    // A stored entry's output IS its compressed data, byte for byte — no
    // inflate involved, so the bound is a plain length check.
    if (rawData.length > options.maxOutputBytes) {
      throw new ZipEntryTooLargeError(entryPath, options.maxOutputBytes);
    }
    return Buffer.from(rawData);
  }
  if (compressionMethod === 8) {
    try {
      return inflateRawSync(rawData, { maxOutputLength: options.maxOutputBytes });
    } catch {
      throw new ZipEntryTooLargeError(entryPath, options.maxOutputBytes);
    }
  }
  throw new Error(`"${entryPath}" uses an unsupported zip compression method (${compressionMethod}) — only store and deflate are supported.`);
}

/** Convenience wrapper — reads the directory AND extracts every entry's
 * content in one call, with no output-size cap. Fine for a trusted,
 * already-bounded test fixture; production code handling an arbitrary
 * upload (settingsPanel.ts's `handleExpandRagZip`) calls
 * `readZipDirectory()`/`extractZipEntryContent()` directly instead, so it
 * can apply its own allowed-path/type/size policy BEFORE paying for any
 * decompression, and a real per-entry+aggregate output cap DURING it. */
export function unzip(buffer: Buffer): ZipEntry[] {
  const directory = readZipDirectory(buffer);
  return directory.map((entry) => ({
    path: entry.path,
    isDirectory: entry.isDirectory,
    content: entry.isDirectory ? Buffer.alloc(0) : extractZipEntryContent(buffer, entry, { maxOutputBytes: Number.MAX_SAFE_INTEGER })
  }));
}
