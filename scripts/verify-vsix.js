// Post-package integrity check for build-extension.bat — `vsce package`
// exiting 0 does NOT guarantee the .vsix it wrote is actually a complete,
// valid zip: if the process is killed/interrupted (closed terminal, AV
// interference, sleep, OOM) partway through writing a ~100MB+ package
// (this extension bundles the full `playwright` runtime dependency), the
// result can be a plausible-sized but truncated file with no zip
// end-of-central-directory record at all — exactly the failure that
// surfaced as "End of central directory record signature not found" when
// a user tried to install a build like that. This script fails the BUILD
// loudly the moment that happens, instead of only ever discovering it
// later at install time on a different machine.
//
// Deliberately dependency-free (same posture as src/rag/zipReader.ts) —
// just reads the newest *.vsix in the project root and scans its tail for
// the EOCD signature (PK\x05\x06), the same check a real unzip tool does
// first.
const fs = require('fs');
const path = require('path');

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_FIXED_SIZE = 22;
const MAX_ZIP_COMMENT_SIZE = 65535;

const root = path.join(__dirname, '..');
const vsixFiles = fs.readdirSync(root).filter((f) => f.endsWith('.vsix'));
if (vsixFiles.length === 0) {
  console.error('verify-vsix: no .vsix file found in the project root — packaging did not produce one.');
  process.exit(1);
}
// `del /q *.vsix` runs right before `vsce package` in build-extension.bat,
// so there should only ever be exactly one — but pick the most recently
// written one defensively rather than assuming.
const newest = vsixFiles
  .map((f) => ({ f, mtime: fs.statSync(path.join(root, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0].f;

const buffer = fs.readFileSync(path.join(root, newest));
if (buffer.length < EOCD_FIXED_SIZE) {
  console.error(`verify-vsix: ${newest} is only ${buffer.length} byte(s) — far too small to be a real package.`);
  process.exit(1);
}

const searchFloor = Math.max(0, buffer.length - EOCD_FIXED_SIZE - MAX_ZIP_COMMENT_SIZE);
let found = false;
for (let i = buffer.length - EOCD_FIXED_SIZE; i >= searchFloor; i--) {
  if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
    found = true;
    break;
  }
}

if (!found) {
  console.error(`verify-vsix: ${newest} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) has no zip end-of-central-directory record.`);
  console.error('verify-vsix: this means packaging was interrupted/killed before it finished writing the file —');
  console.error('verify-vsix: the .vsix on disk is truncated and WILL fail to install. Do not distribute it.');
  console.error('verify-vsix: re-run the build without closing the terminal, letting the machine sleep, or interrupting it.');
  console.error('verify-vsix: if this keeps happening on this machine, check whether antivirus/endpoint protection is interfering');
  console.error('verify-vsix: with writes to a large (~100MB+) file in this project directory.');
  process.exit(1);
}

console.log(`verify-vsix: ${newest} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) is a complete, well-formed zip.`);
