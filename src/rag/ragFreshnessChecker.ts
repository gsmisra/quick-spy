import { RagFrontmatter } from './ragTypes';
import { capabilitiesForFile, extractAllCallableUnitsForDependencyDiscovery } from './ragCapabilityExtraction';
import {
  hashSourceContent,
  stripCapabilitySuffix,
  buildDependencyAwareCanonicalContent,
  isKnownSourceHashScheme,
  SourceHashScheme,
  SOURCE_HASH_SCHEME_LEGACY,
  SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES
} from './ragSourceIdentity';

/**
 * Pure decision logic for Phase 5 (active source-staleness detection) —
 * given a recipe's own `sourcePath`/`sourceHash` provenance (ragTypes.ts)
 * and the OUTCOME of trying to resolve/read that path (an already-computed
 * `SourceFileResolution`, supplied by the vscode-aware
 * rag/ragFreshnessService.ts rather than read here), decides which of five
 * states the recipe is in. Zero `vscode` import, zero filesystem access —
 * directly unit-testable against hand-built fixtures, matching this
 * session's "pure logic tested, vscode glue reviewed" split used
 * throughout the RAG feature (ragRelevanceGate.ts, ragOperationPacking.ts,
 * ...).
 *
 * Five states, deliberately kept distinct rather than collapsed into a
 * boolean "stale or not":
 *  - `fresh`       — provenance recorded, source resolved, hashes match.
 *  - `stale`       — provenance recorded, source resolved, hashes differ
 *                     (or the specific capability it names can no longer be
 *                     found in that file at all — see
 *                     `extractComparableContent()`).
 *  - `missing`     — provenance recorded, but the source path could not be
 *                     found under ANY open workspace folder — moved,
 *                     renamed, or deleted since generation.
 *  - `unverifiable`— no (or incomplete) provenance to check at all — a
 *                     hand-authored recipe, or one generated before this
 *                     provenance existed. NEVER treated as "stale" or
 *                     "fresh" — there's genuinely nothing to compare.
 *  - `error`       — provenance recorded and a source path candidate
 *                     exists, but checking it failed for a reason that has
 *                     nothing to do with content drift (a refused
 *                     path-traversal attempt, a real filesystem read
 *                     error). Kept distinct from `missing` — an `error`
 *                     means "couldn't tell," not "confirmed absent."
 */

export type FreshnessState = 'fresh' | 'stale' | 'missing' | 'unverifiable' | 'error';

/** The outcome of trying to resolve a recipe's `sourcePath` against the
 * open workspace's folder(s) — computed by rag/ragFreshnessService.ts
 * (vscode.workspace.fs is the only thing that can actually answer this),
 * then handed to the pure `classifyFreshness()` below as plain data so the
 * actual state decision stays testable without any I/O. */
export type SourceFileResolution =
  /** No safe candidate path existed under ANY open workspace folder — see
   * ragSourceIdentity.ts's `resolveSafeRelativePath()`. Distinct from
   * `not-found`: this is "the recorded path can never be trusted," not
   * "this specific file isn't there right now." */
  | { kind: 'blocked'; reason: string }
  /** At least one safe candidate path existed, but none of them pointed at
   * a real file. */
  | { kind: 'not-found' }
  /** A safe candidate path resolved to a real file, but reading it failed
   * (permissions, a race with a concurrent delete, ...). */
  | { kind: 'read-error'; message: string }
  /** A safe candidate path resolved to a real, readable file — `content`
   * is that file's CURRENT full text. */
  | {
      kind: 'found';
      content: string;
      resolvedPath: string;
      /** How many OTHER open workspace folders (beyond the one actually
       * used) ALSO have a safe, real file at this same relative path
       * (F09) — `0` is the common, unambiguous case. A multi-root
       * workspace with more than one checkout sharing the same internal
       * folder structure could otherwise silently compare a recipe's
       * hash against WHICHEVER folder happens to come first in
       * `vscode.workspace.workspaceFolders`' own order, with no signal
       * that a choice was even made — this makes that choice visible
       * (see `classifyFreshness()`'s own 'found' case) rather than
       * pretending the match was unambiguous. Never changes WHICH file
       * is compared (the same first-match-in-folder-order behavior as
       * before F09), only whether that choice is disclosed. */
      otherCandidateFolderCount: number;
    };

export interface FreshnessResult {
  state: FreshnessState;
  /** Human-readable explanation — always populated, shown verbatim in the
   * freshness report/output channel/UI. */
  detail: string;
  /** Only for `fresh`/`stale`/`missing`/`error` — echoes the recipe's own
   * `sourcePath` frontmatter value for traceability. */
  sourcePath?: string;
  /** Only when a source file was actually located (`fresh`/`stale`),
   * regardless of whether the hash matched. */
  resolvedPath?: string;
}

/** Retained ONLY as a backward-compatible alias — the actual scheme
 * constants/type now live in rag/ragSourceIdentity.ts (F09), which also now
 * defines a SECOND, dependency-aware scheme; see `SourceHashScheme`'s own
 * doc comment there for what each one covers. */
export const SOURCE_HASH_SCHEME = SOURCE_HASH_SCHEME_LEGACY;

/** Which known scheme a recipe's `sourceHash` was computed under — absent
 * on the frontmatter is ALWAYS `SOURCE_HASH_SCHEME_LEGACY` (every recipe
 * generated before this field existed used that scheme; F09), and a value
 * this build doesn't recognize (a future scheme) resolves to `undefined`
 * so callers report `unverifiable` rather than guessing at how to compare
 * it — never silently treated as either known scheme. */
function resolveHashScheme(raw: string | undefined): SourceHashScheme | undefined {
  if (raw === undefined) {
    return SOURCE_HASH_SCHEME_LEGACY;
  }
  return isKnownSourceHashScheme(raw) ? raw : undefined;
}

/** The capability name encoded in a `sourcePath` (see
 * ragSourceIdentity.ts's `buildSourceIdentity()`), or `undefined` for a
 * whole-file recipe's `sourcePath` (no `#` suffix at all). */
export function extractCapabilityNameFromSourcePath(sourcePath: string): string | undefined {
  const hashIndex = sourcePath.lastIndexOf('#');
  return hashIndex === -1 ? undefined : sourcePath.slice(hashIndex + 1);
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

/** Returns the exact span of `currentContent` that this recipe's
 * `sourceHash` should be compared against — the byte-for-byte same
 * selection logic as generation time (ragCorpusGenerator.ts): the WHOLE
 * file for a whole-file recipe (`sourcePath` has no `#capabilityName`
 * suffix — see `capabilitiesForFile()`'s own whole-file fallback, whose
 * "excerpt" IS the entire file), or ONE specific named capability's own
 * excerpt, re-located by re-running the SAME best-effort extraction used
 * at generation time (ragCapabilityExtraction.ts) against the file's
 * CURRENT content.
 *
 * Comparing a per-capability recipe's `sourceHash` against the whole
 * current file (instead of re-extracting the same capability) would be
 * WRONG — the stored hash was only ever computed over that one capability's
 * own excerpt, so it would almost always mismatch even when that specific
 * capability hasn't changed at all, and never actually confirm anything
 * about the capability it names.
 *
 * Returns `undefined` when a capability name is expected but can no longer
 * be found in the current content at all (renamed, removed, or a shape the
 * best-effort scanner no longer recognizes — see that module's own
 * documented gaps) — callers must treat this as its own distinct signal
 * ("this capability may no longer exist," reported as `stale` by
 * `classifyFreshness()` below), never silently as "matches" or "doesn't
 * match." When more than one capability shares the same name (e.g.
 * overloaded methods — a known extraction-scanner limitation, not
 * disambiguated by name alone), the FIRST one found is used; this is a
 * best-effort re-derivation, not a guarantee.
 *
 * `scheme` (F09) decides WHAT this returns for a per-capability recipe:
 * `SOURCE_HASH_SCHEME_LEGACY` returns just the matched capability's own
 * excerpt (unchanged, original behavior); `SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES`
 * returns that SAME capability's excerpt PLUS its current same-file
 * dependencies' excerpts, re-derived via `buildDependencyAwareCanonicalContent()`
 * — the IDENTICAL canonicalization ragCorpusGenerator.ts used at
 * generation time, so a stored hash is always compared against the exact
 * same shape of text it was originally computed over. Defaults to the
 * legacy scheme for any caller that doesn't pass one.
 *
 * A09: `match` (WHICH capability `#capabilityName` names) is still found
 * against `capabilitiesForFile()`'s own public/capped list — that's the
 * correct, unchanged scope for MATCHING a recipe's own named capability
 * (a recipe was only ever generated for a public one to begin with). Its
 * dependency-aware canonical content, however, is re-derived against the
 * file's COMPLETE callable surface
 * (`extractAllCallableUnitsForDependencyDiscovery()`) — the same broader
 * search space ragCorpusGenerator.ts now uses at generation time (see
 * `buildDependencyAwareCanonicalContent()`'s own doc comment) — so a
 * private/protected Java helper or underscore-prefixed Python function
 * `match` actually calls is re-discoverable HERE too, not just at
 * generation time; verification must always agree with generation on
 * exactly what text a stored hash covers. */
export function extractComparableContent(sourcePath: string, currentContent: string, scheme: SourceHashScheme = SOURCE_HASH_SCHEME_LEGACY): string | undefined {
  const capabilityName = extractCapabilityNameFromSourcePath(sourcePath);
  if (!capabilityName) {
    return currentContent;
  }
  const strippedPath = stripCapabilitySuffix(sourcePath);
  const fileName = basename(strippedPath);
  const capabilities = capabilitiesForFile(fileName, currentContent);
  // F09 fix (a regression from this SAME session's own F02 overload-naming
  // fix): the `#capabilityName` suffix stamped onto `sourcePath` is
  // `capability.namingId ?? capability.name` (see
  // ragCorpusGenerator.ts's `capabilityNameForNaming()`) — for an
  // OVERLOADED method, that's the DISAMBIGUATED id (e.g. "find-a1b2c3"),
  // never the plain callable name ("find") `capabilitiesForFile()` itself
  // returns on `.name`. Matching against `.name` alone (the original,
  // pre-F02 code) would therefore NEVER re-find an overloaded capability
  // again, permanently misreporting it `stale` regardless of whether it
  // actually changed. Checking `.namingId` FIRST (falling back to `.name`
  // for the — far more common — non-overloaded case, where `namingId` is
  // `undefined`) restores correct re-matching for both.
  const match = capabilities.find((c) => c.kind !== 'whole-file' && (c.namingId === capabilityName || c.name === capabilityName));
  if (!match) {
    return undefined;
  }
  if (scheme !== SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES) {
    return match.excerpt;
  }
  const allCallableUnits = extractAllCallableUnitsForDependencyDiscovery(fileName, currentContent);
  return buildDependencyAwareCanonicalContent(match, allCallableUnits);
}

/** Decides ONE recipe's freshness state — see this module's own top-level
 * doc comment for what each state means. `resolution` is `undefined` when
 * checking was skipped entirely (no provenance to check against in the
 * first place — the common `unverifiable` case never needs a resolution
 * attempt at all). */
export function classifyFreshness(
  frontmatter: Pick<RagFrontmatter, 'sourcePath' | 'sourceHash' | 'sourceHashScheme' | 'sourceMapped'>,
  resolution: SourceFileResolution | undefined
): FreshnessResult {
  const { sourcePath, sourceHash, sourceHashScheme, sourceMapped } = frontmatter;

  if (!sourcePath || !sourceHash) {
    return {
      state: 'unverifiable',
      detail:
        !sourcePath && !sourceHash
          ? 'No source provenance recorded (a hand-authored recipe, or one generated before staleness tracking existed) — nothing to check this against.'
          : 'Only one of sourcePath/sourceHash is recorded — incomplete provenance, cannot check.'
    };
  }

  // F09: a scheme this build doesn't recognize (a recipe stamped by a
  // NEWER version of this extension, using a hashing formula this one
  // predates) must never be silently compared as if it were a known
  // scheme — that could compare the stored hash against the WRONG notion
  // of "comparable content" and report a false fresh/stale. "Can't tell
  // which formula this is" is its own honest `unverifiable`, not a guess.
  const scheme = resolveHashScheme(sourceHashScheme);
  if (!scheme) {
    return {
      state: 'unverifiable',
      detail: `This recipe's sourceHash was computed under a hashing scheme ("${sourceHashScheme}") this version doesn't recognize — cannot verify freshness against it.`,
      sourcePath
    };
  }

  if (!resolution) {
    return { state: 'unverifiable', detail: 'Freshness was not checked for this recipe.', sourcePath };
  }

  switch (resolution.kind) {
    case 'blocked':
      return {
        state: 'error',
        detail: `Refused to resolve sourcePath "${sourcePath}" — ${resolution.reason}. This recipe's freshness could not be determined.`,
        sourcePath
      };
    case 'read-error':
      return {
        state: 'error',
        detail: `Found "${sourcePath}" but could not read it (${resolution.message}) — freshness could not be determined.`,
        sourcePath
      };
    case 'not-found':
      // A07: `sourceMapped === false` means generation time ITSELF already
      // confirmed this exact sourcePath could not be found in any open
      // workspace folder (see ragCorpusGenerator.ts) — a genuinely
      // external upload (e.g. a shared framework project never opened
      // here) that was NEVER resolvable to begin with, not a source that
      // went missing. Reporting that as `missing` (and, via
      // agenticModeController.ts's/objectSpyPanel.ts's shared
      // stale-or-missing hard-exclusion policy, silently discarding a
      // brand-new, perfectly valid recipe the moment it's generated) would
      // be actively misleading — there is no "before" state it regressed
      // FROM. `unverifiable` is the honest state here, and is never
      // hard-excluded (see those callers' own doc comments) — the recipe
      // stays fully usable, exactly as if this field didn't exist, until
      // its source is actually opened in a workspace and can be checked
      // for real. `sourceMapped === true` (confirmed present at
      // generation) or `undefined` (every recipe generated before this
      // field existed, or hand-authored) both preserve the ORIGINAL,
      // unchanged "not found -> missing" behavior — this only ever makes
      // reporting MORE precise, never less, for a recipe that was already
      // known-present at some point.
      if (sourceMapped === false) {
        return {
          state: 'unverifiable',
          detail: `"${sourcePath}" was never confirmed present in any open workspace folder — this recipe was generated from an external upload whose source was not (and, right now, still isn't) part of a project opened in this workspace, so its freshness cannot be verified. Open the project this source belongs to for freshness tracking to become possible.`,
          sourcePath
        };
      }
      return {
        state: 'missing',
        // F09 fix: the OLD wording ("moved, renamed, or deleted") implied
        // the file definitely existed here before and is now gone — but
        // "not found under any CURRENTLY OPEN workspace folder" is
        // equally consistent with a source that was never part of any
        // workspace this checker has ever seen (e.g. a recipe generated
        // from an uploaded zip/archive of a project that isn't, and may
        // never have been, opened here) — a meaningfully different,
        // more benign situation than "someone deleted it," which this
        // wording no longer asserts as the only explanation. (A07: for a
        // recipe stamped with `sourceMapped`, that ambiguity is now
        // actually resolved above rather than just caveated — this
        // generic wording only remains reachable for `sourceMapped ===
        // true`/`undefined`, where "went missing" is the correct read.)
        detail: `"${sourcePath}" was not found under any currently open workspace folder — either it was moved/renamed/deleted since this recipe was generated, or its source was never part of a project opened in this workspace to begin with.`,
        sourcePath
      };
    case 'found': {
      const capabilityName = extractCapabilityNameFromSourcePath(sourcePath);
      const comparable = extractComparableContent(sourcePath, resolution.content, scheme);
      // F09: an unresolved source-root ambiguity — more than one open
      // workspace folder has a safe, real file at this exact relative path
      // — is disclosed on EVERY outcome below (fresh, stale, or the
      // capability-removed case), never silently on just one of them; a
      // reviewer relying on a "stale" (or a "fresh") verdict deserves to
      // know it was computed against only ONE of several plausible real
      // files, regardless of which state it landed on.
      const ambiguityNote =
        resolution.otherCandidateFolderCount > 0
          ? ` NOTE: ${resolution.otherCandidateFolderCount} other open workspace folder(s) ALSO have a file at this same relative path — this comparison used "${resolution.resolvedPath}" (the first match, in folder order); verify this is the intended source if multiple checkouts of a similarly-structured project are open.`
          : '';
      if (comparable === undefined) {
        return {
          state: 'stale',
          detail: `The capability "${capabilityName}" could no longer be found in "${resolution.resolvedPath}" (renamed, removed, or no longer recognized by best-effort extraction) — this recipe likely needs review or regeneration.${ambiguityNote}`,
          sourcePath,
          resolvedPath: resolution.resolvedPath
        };
      }
      const currentHash = hashSourceContent(comparable);
      if (currentHash === sourceHash) {
        return { state: 'fresh', detail: `Matches the current content of "${resolution.resolvedPath}".${ambiguityNote}`, sourcePath, resolvedPath: resolution.resolvedPath };
      }
      return {
        state: 'stale',
        detail: `"${resolution.resolvedPath}"${capabilityName ? ` (capability "${capabilityName}")` : ''} has changed since this recipe was generated — consider regenerating this recipe.${ambiguityNote}`,
        sourcePath,
        resolvedPath: resolution.resolvedPath
      };
    }
  }
}
