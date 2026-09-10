import * as vscode from 'vscode';
import * as fs from 'fs';
import { RagRecipe } from './ragTypes';
import { getOrBuildRagIndex } from './ragIndexer';
import { validateSafeRelativeSegments, stripCapabilitySuffix, isPathContained } from './ragSourceIdentity';
import { classifyFreshness, FreshnessResult, FreshnessState, SourceFileResolution } from './ragFreshnessChecker';

/**
 * The vscode-aware half of Phase 5 (active source-staleness detection) —
 * resolves each recipe's `sourcePath` against every OPEN WORKSPACE FOLDER
 * (multi-root support: the `.github/rag` corpus itself always lives under
 * folder [0], same single-root convention as ragIndexer.ts/
 * ragCorpusGenerator.ts, but the SOURCE files a recipe's `sourcePath`
 * describes may live in a different folder of the same multi-root
 * workspace — e.g. one folder holding the test-automation repo with
 * `.github/rag`, another holding the shared library the recipes were
 * actually generated from), reads/stat's the real filesystem, and hands
 * the outcome to ragFreshnessChecker.ts's pure `classifyFreshness()` for
 * the actual state decision. Cached in-memory (invalidated by a
 * fingerprint of every recipe file's own path/mtime/size PLUS every
 * candidate source file's path/mtime/size — a cheap `stat`-only pass, no
 * content read), with an explicit `forceRefresh` escape hatch — the exact
 * same "re-check only when something actually changed, but always allow a
 * user to force it" convention as ragIndexer.ts's own cache.
 *
 * Deliberately reviewed-not-directly-tested, same as ragIndexer.ts and
 * ragCorpusGenerator.ts — every piece of real decision logic (state
 * classification, path-traversal protection) lives in, and is unit tested
 * from, the pure modules it calls into (ragFreshnessChecker.ts,
 * ragSourceIdentity.ts).
 */

export interface RecipeFreshnessEntry extends FreshnessResult {
  recipeId: string;
  title: string;
  /** Absolute path of the recipe's own `.md` file. */
  filePath: string;
  /** Path relative to `.github/rag/` — see RagRecipe's own doc comment. */
  relativePath: string;
}

export interface FreshnessReport {
  generatedAt: string;
  entries: RecipeFreshnessEntry[];
  counts: Record<FreshnessState, number>;
}

const EMPTY_COUNTS: Record<FreshnessState, number> = { fresh: 0, stale: 0, missing: 0, unverifiable: 0, error: 0 };

async function statOrMissing(uri: vscode.Uri): Promise<string> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return `${uri.fsPath}:${stat.mtime}:${stat.size}`;
  } catch {
    return `${uri.fsPath}:MISSING`;
  }
}

/** One safe candidate location for a recipe's `sourcePath` — the folder it
 * was checked against alongside the resulting URI, since a real-path
 * containment re-check (F09, see `isSymlinkEscapeSafe()` below) needs to
 * know which folder's OWN root a given candidate is supposed to be nested
 * inside. */
interface SafeCandidate {
  folder: vscode.WorkspaceFolder;
  uri: vscode.Uri;
}

/** Every SAFE candidate location for `sourcePath`, one per open workspace
 * folder for which `validateSafeRelativeSegments()` approves it — in
 * folder order, since that's also the order `resolveSourceFile()` searches
 * in. Built via `vscode.Uri.joinPath(folder.uri, ...)` (F09 fix), which
 * preserves that folder's OWN scheme/authority — a `file://` local
 * checkout, but equally a `vscode-remote://`/`vscode-vfs://`/... URI for a
 * Remote-SSH/WSL/Codespaces/virtual-filesystem workspace folder, all of
 * which `vscode.workspace.fs` already handles transparently (the same
 * scheme-agnostic API ragIndexer.ts's own `vscode.workspace.findFiles`
 * already relies on) — never forced through a bare local `fsPath` string
 * and re-wrapped as `vscode.Uri.file()`, which would silently point
 * somewhere wrong (or nowhere at all) for anything but a plain local
 * checkout. A `sourcePath` unsafe relative to every folder yields an empty
 * list (never a thrown error — "no safe candidate" is itself a valid,
 * reportable outcome, see `resolveSourceFile()`'s own `blocked` case
 * below). */
function safeCandidates(workspaceFolders: readonly vscode.WorkspaceFolder[], sourcePath: string): SafeCandidate[] {
  const stripped = stripCapabilitySuffix(sourcePath);
  const segments = validateSafeRelativeSegments(stripped);
  if (!segments) {
    return [];
  }
  return workspaceFolders.map((folder) => ({ folder, uri: vscode.Uri.joinPath(folder.uri, ...segments) }));
}

/** SECOND, independent containment check beyond `validateSafeRelativeSegments()`'s
 * own path-TEXT validation (F09) — a `sourcePath` with no `..`/absolute
 * segment can still, once symlinks are resolved, land OUTSIDE the
 * workspace folder it appears to be relative to: an intermediate directory
 * segment (or the final file itself) can be a symlink pointing elsewhere
 * on disk entirely (e.g. into a sibling checkout, or `/etc`). Only
 * meaningful — and only attempted — for a plain local `file://` URI:
 * `fs.promises.realpath()` resolves symlinks on the real local
 * filesystem, which is not a concept `vscode.workspace.fs`'s own
 * scheme-agnostic API exposes for a Remote-SSH/WSL/virtual-filesystem
 * provider. Anything other than `file://` is treated as ALREADY safe here
 * — a real, documented, scheme-scoped gap (those providers may enforce
 * their own containment internally, but this checker has no portable way
 * to verify that itself), not a general fix for every possible workspace
 * kind. A `file://` URI whose real target can't even be resolved (a
 * broken symlink, a permission error) is treated as UNSAFE — never assumed
 * contained just because it couldn't be checked. */
async function isSymlinkEscapeSafe(candidate: SafeCandidate): Promise<boolean> {
  if (candidate.uri.scheme !== 'file') {
    return true;
  }
  try {
    const [realTarget, realRoot] = await Promise.all([fs.promises.realpath(candidate.uri.fsPath), fs.promises.realpath(candidate.folder.uri.fsPath)]);
    return isPathContained(realTarget, realRoot);
  } catch {
    return false;
  }
}

/** A human-readable label for a resolved URI — the plain local filesystem
 * path for the common `file://` case, or the full URI string (scheme,
 * authority and all) for anything else, so a report about a Remote-SSH/
 * WSL/virtual-filesystem source never silently shows a misleading bare
 * local-looking path that isn't actually where the file lives. */
function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

/** Resolves ONE recipe's `sourcePath` against every open workspace folder,
 * in order, returning the first that is both a SAFE candidate path (see
 * ragSourceIdentity.ts's `validateSafeRelativeSegments()`, PLUS the
 * real-path symlink-containment re-check below — F09) and an actual,
 * readable file. Distinguishes THREE outcomes a plain try/catch used to
 * conflate (F09 fix):
 *  - `blocked` — unsafe relative to every folder; the recorded path can
 *    never be trusted.
 *  - `not-found` — every safe candidate was checked and genuinely doesn't
 *    exist there (a real "file not found," never just any thrown error) —
 *    a candidate that escapes its folder's real root via a symlink (see
 *    `isSymlinkEscapeSafe()`) is folded into this SAME outcome, exactly
 *    like a candidate that plainly doesn't exist: this checker never
 *    silently reads content it can't first confirm actually lives inside
 *    the workspace it's supposedly relative to, and — same reasoning as
 *    `FileNotFound` above — one folder's untrustworthy candidate must
 *    never stop a DIFFERENT folder's own, genuinely safe candidate from
 *    still being tried.
 *  - `error` (surfaced as `read-error`) — a stat/read call failed for a
 *    reason OTHER than "the file isn't there" (permission denied, the
 *    provider being unavailable, ...) — a real problem this checker
 *    couldn't get past, not a confirmed absence, and never silently
 *    retried against the next folder as if it were just a miss. */
/** Cheap, STAT-ONLY (never reads content) count of how many of
 * `remainingCandidates` ALSO resolve to a safe, real file — used only to
 * populate `SourceFileResolution`'s `otherCandidateFolderCount` (F09), an
 * informational enrichment of an ALREADY-successful resolution. Any
 * individual candidate's own error here is swallowed — a permission
 * problem checking a SECOND, non-authoritative folder must never turn an
 * already-confirmed real match into a failure. */
async function countOtherSafeCandidates(remainingCandidates: SafeCandidate[]): Promise<number> {
  let count = 0;
  for (const candidate of remainingCandidates) {
    try {
      const stat = await vscode.workspace.fs.stat(candidate.uri);
      if (stat.type === vscode.FileType.File && (await isSymlinkEscapeSafe(candidate))) {
        count++;
      }
    } catch {
      // Ignore — this is informational-only ambiguity detection, never a
      // source of a real failure for the primary resolution.
    }
  }
  return count;
}

/** Exported (A07) so rag/ragCorpusGenerator.ts can run this EXACT SAME
 * resolution — not a re-implementation that could quietly drift out of
 * sync — at GENERATION time, to determine whether a newly generated
 * recipe's own `sourcePath` can be confirmed present in some open
 * workspace folder right now (stamped as `sourceMapped` — see
 * ragTypes.ts's own doc comment on that field for why this distinction
 * matters: an upload that was NEVER mapped into any open workspace must
 * never be reported `missing` later just because it was never resolvable
 * in the first place). */
export async function resolveSourceFile(workspaceFolders: readonly vscode.WorkspaceFolder[], sourcePath: string): Promise<SourceFileResolution> {
  const candidates = safeCandidates(workspaceFolders, sourcePath);
  if (candidates.length === 0) {
    return { kind: 'blocked', reason: 'the recorded source path is unsafe (absolute, or escapes) relative to every open workspace folder' };
  }
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const { uri } = candidate;
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        continue; // genuinely not present under this folder — try the next candidate
      }
      // A REAL error (permission denied, the provider being unavailable,
      // a network hiccup on a remote workspace, ...) — never silently
      // treated as "just try the next folder," which would misreport a
      // genuine problem as an ordinary "moved or deleted" miss.
      return { kind: 'read-error', message: err instanceof Error ? err.message : String(err) };
    }
    if (stat.type !== vscode.FileType.File) {
      continue; // a directory happens to share the name — not a real match
    }
    // F09: confirm the candidate's REAL (symlink-resolved) location is
    // still inside this folder's own real root BEFORE ever reading its
    // content — see `isSymlinkEscapeSafe()`'s own doc comment for exactly
    // what this catches (an intermediate directory, or the file itself,
    // being a symlink that points outside the workspace) and its scoped
    // (file:// only) limitation.
    if (!(await isSymlinkEscapeSafe(candidate))) {
      continue;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      // F09: source-root ambiguity — count (stat-only, never read) how
      // many of the REMAINING candidates ALSO resolve to a safe file,
      // so a multi-root workspace with more than one matching checkout
      // never silently picks "whichever folder came first" without any
      // trace of that choice — see `SourceFileResolution`'s own doc
      // comment on this field and `classifyFreshness()`'s 'found' case,
      // which surfaces it in the report.
      const otherCandidateFolderCount = await countOtherSafeCandidates(candidates.slice(i + 1));
      return { kind: 'found', content: new TextDecoder('utf-8').decode(bytes), resolvedPath: displayPath(uri), otherCandidateFolderCount };
    } catch (err) {
      return { kind: 'read-error', message: err instanceof Error ? err.message : String(err) };
    }
  }
  return { kind: 'not-found' };
}

/** Fingerprint of everything a freshness report depends on: every recipe
 * file's own path/mtime/size (so an edited/added/removed recipe always
 * invalidates the cache, same as ragIndexer.ts's own index cache) PLUS
 * every SAFE candidate source path's path/mtime/size (so a change to the
 * ACTUAL source file the recipe was generated from also invalidates it) —
 * stat-only, no content read, so computing this is cheap even though the
 * real check below reads full file contents. */
async function computeFreshnessFingerprint(recipes: RagRecipe[], workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<string> {
  const recipeParts = await Promise.all(recipes.map((r) => statOrMissing(vscode.Uri.file(r.filePath))));
  const sourceParts = await Promise.all(
    recipes
      .filter((r) => r.frontmatter.sourcePath && r.frontmatter.sourceHash)
      .flatMap((r) => safeCandidates(workspaceFolders, r.frontmatter.sourcePath!))
      .map((candidate) => statOrMissing(candidate.uri))
  );
  return [...recipeParts, ...sourceParts].sort().join('|');
}

async function checkRecipe(recipe: RagRecipe, workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<RecipeFreshnessEntry> {
  const { sourcePath, sourceHash, sourceHashScheme, sourceMapped, id, title } = recipe.frontmatter;
  const resolution = sourcePath && sourceHash ? await resolveSourceFile(workspaceFolders, sourcePath) : undefined;
  const result = classifyFreshness({ sourcePath, sourceHash, sourceHashScheme, sourceMapped }, resolution);
  return { recipeId: id, title, filePath: recipe.filePath, relativePath: recipe.relativePath, ...result };
}

async function buildReport(recipes: RagRecipe[], workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<FreshnessReport> {
  const entries = await Promise.all(recipes.map((r) => checkRecipe(r, workspaceFolders)));
  const counts: Record<FreshnessState, number> = { ...EMPTY_COUNTS };
  for (const entry of entries) {
    counts[entry.state] += 1;
  }
  return { generatedAt: new Date().toISOString(), entries, counts };
}

interface CachedFreshnessReport {
  fingerprint: string;
  report: FreshnessReport;
}

let cached: CachedFreshnessReport | undefined;

export interface GetFreshnessReportOptions {
  /** Bypasses the cache and always rebuilds — the "Check RAG Source
   * Freshness" command's own explicit user-triggered refresh always passes
   * this; an internal/automatic consumer wanting a cheap best-effort read
   * would not. The freshly-built result still REPLACES the cache either
   * way, so the next non-forced call benefits from it. */
  forceRefresh?: boolean;
  /** Forwarded to `getOrBuildRagIndex()` — called once per recipe file that
   * exists but fails to parse. */
  onWarn?: (message: string) => void;
}

/** Builds (or reuses a cached) freshness report for every recipe under
 * `workspaceRoot`'s `.github/rag/` folder. An empty/missing corpus (no
 * recipes at all) reports an empty, all-zero-count report — never an
 * error, same "nothing to check" convention as `getOrBuildRagIndex()`'s own
 * `undefined`. */
export async function getOrBuildFreshnessReport(workspaceRoot: vscode.Uri, options: GetFreshnessReportOptions = {}): Promise<FreshnessReport> {
  const index = await getOrBuildRagIndex(workspaceRoot, options.onWarn);
  const recipes = index?.recipes ?? [];
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  const fingerprint = await computeFreshnessFingerprint(recipes, workspaceFolders);
  if (!options.forceRefresh && cached && cached.fingerprint === fingerprint) {
    return cached.report;
  }

  const report = await buildReport(recipes, workspaceFolders);
  cached = { fingerprint, report };
  return report;
}

/** Forces the next `getOrBuildFreshnessReport()` call to rebuild from disk
 * regardless of the fingerprint — exposed for a future explicit
 * "invalidate" affordance and for tests; the command handler itself always
 * passes `forceRefresh: true` directly instead of needing this. */
export function clearRagFreshnessCache(): void {
  cached = undefined;
}
