#!/usr/bin/env node
// Auto-increments package.json's patch/build number every time
// build-extension.bat runs, so each generated .vsix carries a unique,
// monotonically increasing version with no manual bookkeeping. This is also
// what shows up as the "vX.Y.Z" badge on the main Object Spy panel
// (ObjectSpyPanel reads it straight from context.extension.packageJSON), and
// (see stampArchitectureDocVersion() below) next to the title of the
// "Architecture & Technical Information" page — that page is a static file
// opened directly via vscode.env.openExternal (settingsPanel.ts), not a
// webview rendered with live extension state, so it has no other way to
// know the current build number; stamping it here at build time is the one
// place that's actually true.
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);

const parts = pkg.version.split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) {
  parts.push(0);
}
parts[2] += 1; // bump the patch/build component only
pkg.version = parts.slice(0, 3).join('.');

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Version bumped to ${pkg.version}`);

stampArchitectureDocVersion(pkg.version);

/** Rewrites every "Architecture &amp; Technical Information" occurrence in
 * media/architecture.html to end in " -- vX.Y.Z" for the CURRENT build.
 * Idempotent: matches the marker plus an OPTIONAL existing " -- vX.Y.Z"
 * stamp from a previous build in one pass and replaces the whole thing, so
 * running this any number of times always leaves exactly one, up-to-date
 * stamp per occurrence -- never an accumulating chain of old ones. */
function stampArchitectureDocVersion(version) {
  const docPath = path.join(__dirname, '..', 'media', 'architecture.html');
  const html = fs.readFileSync(docPath, 'utf8');
  const marker = 'Architecture &amp; Technical Information';
  // Precisely three dot-separated numeric groups (real semver shape) --
  // NOT a generic [\d.]+ blob, which would greedily swallow a trailing
  // sentence-ending period too (e.g. "v0.1.72." before "Generated
  // locally...") and silently corrupt the surrounding prose on every build.
  const stampPattern = new RegExp(`${marker}( -- v\\d+\\.\\d+\\.\\d+)?`, 'g');
  const stamped = html.replace(stampPattern, `${marker} -- v${version}`);
  fs.writeFileSync(docPath, stamped, 'utf8');
  console.log(`Stamped media/architecture.html with v${version}`);
}
