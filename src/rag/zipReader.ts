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

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
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

function extractEntry(
  buffer: Buffer,
  fileName: string,
  localHeaderOffset: number,
  compressionMethod: number,
  compressedSize: number
): ZipEntry {
  const normalizedPath = fileName.replace(/\\/g, '/');
  if (normalizedPath.endsWith('/')) {
    return { path: normalizedPath, isDirectory: true, content: Buffer.alloc(0) };
  }

  if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Not a valid zip file — malformed local file header for "${fileName}".`);
  }
  const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const rawData = buffer.subarray(dataStart, dataStart + compressedSize);

  let content: Buffer;
  if (compressionMethod === 0) {
    content = Buffer.from(rawData);
  } else if (compressionMethod === 8) {
    content = inflateRawSync(rawData);
  } else {
    throw new Error(`"${fileName}" uses an unsupported zip compression method (${compressionMethod}) — only store and deflate are supported.`);
  }
  return { path: normalizedPath, isDirectory: false, content };
}

/** Parses a complete zip file buffer into its entries. Throws a clear error
 * for anything this deliberately doesn't support (ZIP64, a corrupt/
 * non-zip buffer, an unsupported compression method) rather than silently
 * returning partial or garbled content. */
export function unzip(buffer: Buffer): ZipEntry[] {
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

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Not a valid zip file — malformed central directory record.');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf-8', offset + 46, offset + 46 + fileNameLength);

    entries.push(extractEntry(buffer, fileName, localHeaderOffset, compressionMethod, compressedSize));

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}
