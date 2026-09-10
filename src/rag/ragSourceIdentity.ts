import * as crypto from 'crypto';
import * as path from 'path';
import type { ExtractedCapability } from './ragCapabilityExtraction';
import { hasCallShapedOccurrence } from './ragSourceGrounding';

/**
 * Ground-truth source identity/module-path helpers for "Generate RAG Corpus
 * format" (ragCorpusGenerator.ts) — deliberately pure, zero `vscode`
 * import, so this is directly unit-testable.
 *
 * The generator only ever hands the model a bare filename (e.g.
 * "PostgresHelper.java") plus the file's own content — never the file's
 * real location within the uploaded project. That's enough for the model
 * to infer a Java package MOST of the time (a `package foo.bar;`
 * declaration is usually right there in the file), but Python has no such
 * self-declared module path at all — it's determined purely by the file's
 * position under a package root, information that simply isn't in the
 * content. Two same-named modules from different packages, or a config
 * file's own "where does this live" context, hit the identical gap. This
 * module supplies exactly the ground-truth facts ragCorpusGenerator.ts
 * DOES already have (the upload's own relative path, and — for Java — the
 * file's own authoritative package declaration) so they can be handed to
 * the model explicitly instead of leaving it to guess from a bare
 * filename.
 */

/** The file's full identity relative to the project it was uploaded from —
 * e.g. "src/main/java/com/acme/PostgresHelper.java" for a zip entry, or
 * just "PostgresHelper.java" for a directly-dropped single file with no
 * surrounding folder context — with an optional `#capabilityName` suffix
 * (e.g. "...PostgresHelper.java#queryOne") when this recipe describes ONE
 * specific capability (see ragCapabilityExtraction.ts) rather than the
 * whole file. Stamped onto a generated recipe's `sourcePath` frontmatter
 * field (see ragTypes.ts) so a reviewer can always trace it back to
 * exactly which upload — and, for a per-capability recipe, which specific
 * method — produced it. Computed here from data the generator already
 * has, never trusted from the model's own output. */
export function buildSourceIdentity(fileName: string, relativePath?: string, capabilityName?: string): string {
  const trimmed = relativePath?.replace(/^\/+|\/+$/g, '');
  const identity = trimmed ? `${trimmed}/${fileName}` : fileName;
  return capabilityName ? `${identity}#${capabilityName}` : identity;
}

/** Best-effort extraction of a Java source file's OWN declared package —
 * ground truth straight from its `package foo.bar;` statement, rather than
 * inferred from an upload path that may not even reach back to a real
 * package root (e.g. a zip's own top-level folder name) or may simply
 * disagree with the file's real package. Matches the package keyword at
 * the start of a line (ignoring leading whitespace), same as `javac`
 * itself requires. Returns `undefined` for non-Java content, a file using
 * the unnamed/default package, or anything that doesn't match — callers
 * treat that as "no ground truth available," not as an error. */
export function extractJavaPackageDeclaration(content: string): string | undefined {
  const match = content.match(/^[ \t]*package\s+([a-zA-Z_$][\w$]*(?:\s*\.\s*[a-zA-Z_$][\w$]*)*)\s*;/m);
  return match ? match[1].replace(/\s+/g, '') : undefined;
}

/** A stable content fingerprint for the ORIGINAL uploaded source file —
 * stamped onto a generated recipe's `sourceHash` frontmatter field
 * (ragTypes.ts) alongside `sourcePath`, the provenance half of staleness
 * detection: if a recipe's `sourcePath` still resolves to a real file
 * later (many uploads mirror files that remain in the same project), that
 * file's CURRENT hash can be compared against the hash stamped here to
 * tell whether the recipe was generated from what's actually still there,
 * or has silently drifted since. This function only computes the
 * fingerprint itself; rag/ragFreshnessChecker.ts and
 * rag/ragFreshnessService.ts are the active staleness CHECKING/UI built on
 * top of it. SHA-256 rather than SHA-1
 * (used elsewhere in this codebase for non-security path disambiguation,
 * e.g. ragRecipeNormalizer.ts's `resolveRagTargets`) since this is an
 * integrity fingerprint people may eventually reason about trusting,
 * not just a collision-avoidance suffix. */
export function hashSourceContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Strips a trailing `#capabilityName` suffix (see `buildSourceIdentity()`
 * above) off a stamped `sourcePath`, returning the plain file path
 * underneath — the inverse half of that function, needed anywhere
 * `sourcePath` must be treated as an actual file path again (active
 * staleness checking — rag/ragFreshnessChecker.ts, rag/ragFreshnessService.ts —
 * rather than just a human-readable provenance string). A `sourcePath` with
 * no capability suffix (a whole-file recipe) is returned unchanged. */
export function stripCapabilitySuffix(sourcePath: string): string {
  const hashIndex = sourcePath.lastIndexOf('#');
  return hashIndex === -1 ? sourcePath : sourcePath.slice(0, hashIndex);
}

/** Validates `relPath` — a recipe's own `sourcePath` frontmatter field,
 * already stripped of any `#capabilityName` suffix — refusing anything
 * that could escape whatever root it's later joined against, and returns
 * the VALIDATED PATH SEGMENTS (never a joined string) when it's safe.
 * `sourcePath` is team-authored/PR-reviewed content, the same trust level
 * as this extension's other `.github/*` files (see ragTypes.ts's own doc
 * comment) — but active staleness checking (rag/ragFreshnessService.ts) is
 * the first thing in this codebase that ever turns that stamped text BACK
 * into a real filesystem read, so this function exists as explicit,
 * defense-in-depth path-traversal protection regardless of that trust
 * level: a hand-edited or otherwise malformed `sourcePath` (e.g.
 * `"../../../../etc/passwd"` or `"C:\\Windows\\System32\\..."`) must never
 * cause a read outside the workspace folder it's supposedly relative to.
 *
 * Refuses: an absolute POSIX path (leading `/` or `\`), a Windows
 * drive-letter path (`C:\...`), and ANY `..` path segment at all — even one
 * that would arguably stay within bounds once later segments are applied —
 * since reasoning about "does this net out safe" is exactly the kind of
 * subtle path-traversal bug this function exists to avoid.
 *
 * Deliberately returns SEGMENTS, not a joined local filesystem path (F09
 * fix) — the ONLY safe way for a vscode-aware caller to then build the
 * actual candidate URI is `vscode.Uri.joinPath(folder.uri, ...segments)`,
 * which preserves that folder's OWN scheme/authority (`vscode-remote://`,
 * `vscode-vfs://`, ... for a Remote-SSH/WSL/Codespaces/virtual-filesystem
 * workspace folder — NOT always a plain local `file://` one). Joining
 * through a bare `fsPath` string and re-wrapping via the OLDER
 * `resolveSafeRelativePath()` below (kept for its own existing callers)
 * silently discards that scheme/authority, breaking freshness checking
 * entirely for anything other than a local disk checkout — since every
 * segment here is already guaranteed free of `..`/absolute components,
 * `joinPath` can never be tricked into escaping the folder it's joined
 * against, regardless of scheme; no separate string-based containment
 * check is needed on top of this.
 *
 * Pure string logic only — no filesystem access — so this is directly
 * unit-testable without a real disk or vscode's own (possibly virtual)
 * filesystem. Returns `undefined` for anything refused; callers must never
 * fall back to trying an unsafe path anyway. */
export function validateSafeRelativeSegments(relPath: string): string[] | undefined {
  const trimmed = relPath.trim();
  if (!trimmed || /^[\\/]/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    return undefined;
  }
  return segments;
}

/** LOCAL-filesystem-path convenience wrapper around
 * `validateSafeRelativeSegments()` above — joins the validated segments
 * against `rootFsPath` (one open workspace folder's own LOCAL filesystem
 * root) and re-checks containment on the resulting string as a second,
 * independent line of defense. Only correct for a plain local `file://`
 * workspace folder — see `validateSafeRelativeSegments()`'s own doc
 * comment for why a scheme-preserving caller (rag/ragFreshnessService.ts)
 * uses that function directly with `vscode.Uri.joinPath()` instead of
 * this one. Kept for any caller that genuinely only ever deals with local
 * filesystem paths. */
export function resolveSafeRelativePath(rootFsPath: string, relPath: string): string | undefined {
  const segments = validateSafeRelativeSegments(relPath);
  if (!segments) {
    return undefined;
  }
  const candidate = path.normalize(path.join(path.normalize(rootFsPath), ...segments));
  return isPathContained(candidate, rootFsPath) ? candidate : undefined;
}

/** Whether `candidatePath` is EQUAL TO, or nested inside, `rootPath` — pure
 * string comparison on two already-computed filesystem paths, no I/O of its
 * own. Used by `resolveSafeRelativePath()` above for its own LOGICAL
 * (segment-text-only) containment check, and by
 * rag/ragFreshnessService.ts (F09) for a SECOND, independent containment
 * check against each candidate's own REAL (symlink-resolved) path — the two
 * are complementary, not redundant: `validateSafeRelativeSegments()` only
 * ever reasons about the path TEXT (no `..`, not absolute), which says
 * nothing about a symlink placed inside the workspace folder (an
 * INTERMEDIATE directory segment, or the final file itself) whose real
 * target resolves somewhere else on disk entirely — a textually-safe
 * relative path can still, once symlinks are followed, point outside the
 * folder it appears to be relative to. Both normalize before comparing, so
 * a trailing separator or `.`/`..` segment difference between the two
 * inputs never causes a false mismatch. */
export function isPathContained(candidatePath: string, rootPath: string): boolean {
  const normalizedRoot = path.normalize(rootPath);
  const normalizedCandidate = path.normalize(candidatePath);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootWithSep);
}

// --- F09 (dependency-aware hashing + a persisted hash-scheme version) -------
//
// The gap this section closes: `hashSourceContent()` above, applied to just
// ONE capability's own excerpt, is blind to a real and common failure mode —
// capability `find(id)` calls a private/internal same-file helper
// `lookupRow(id)`; a reviewer changes ONLY `lookupRow`'s behavior (a real,
// meaningful behavior change for anyone relying on `find`) and `find`'s OWN
// excerpt is byte-for-byte unchanged, so the OLD (still current) hashing
// scheme reports this recipe as `fresh` when it is, in every way that
// matters to a caller, stale. This section adds a SECOND, opt-in hashing
// scheme that also folds in every same-file capability the excerpt actually
// calls (transitively) — see `computeDependencyAwareSourceHash()` — WITHOUT
// silently reinterpreting hashes any ALREADY-generated recipe was stamped
// with under the old, excerpt-only formula: `RagFrontmatter.sourceHashScheme`
// (ragTypes.ts) records WHICH formula a given recipe's `sourceHash` was
// actually computed under, so ragFreshnessChecker.ts always re-derives
// comparable content the SAME way generation computed it, never a newer
// formula's notion of "comparable" against an older formula's hash. A
// recipe predating this field (`sourceHashScheme` absent) is always treated
// as the ORIGINAL scheme — nothing needs to be regenerated for this to be
// safe.
//
// KNOWN, DELIBERATELY UNIMPLEMENTED gap: dependency tracking here is
// SAME-FILE only — a capability calling into a DIFFERENT uploaded file
// (or, more commonly, code that was never part of any upload at all) is
// not covered. Real cross-file dependency tracking needs a project-wide
// call graph this pipeline has no way to build (it only ever sees
// whatever files were in ONE upload batch, not a full checkout) — future
// work, not something this section's checks imply is covered.

/** The ORIGINAL hashing scheme (unchanged since Phase 5) — a single
 * SHA-256 digest over either an entire file's raw content (a whole-file
 * recipe) or one specific capability's own verbatim excerpt ALONE, with no
 * awareness of anything that excerpt calls into. Every recipe generated
 * before `sourceHashScheme` existed used this scheme; its absence on a
 * recipe's frontmatter is always interpreted as this value, never as "no
 * scheme"/an error. */
export const SOURCE_HASH_SCHEME_LEGACY = 'sha256-raw-v1' as const;

/** SHA-256 over a capability's own excerpt PLUS the excerpts of every
 * OTHER same-file capability it calls, transitively (see
 * `computeDependencyAwareSourceHash()`) — closes the "a helper this
 * capability depends on changed but the recipe still reports fresh" gap,
 * for same-file dependencies. Used for every NEWLY generated per-capability
 * recipe going forward; a whole-file recipe has no same-file "other
 * capability" to depend on and keeps using `SOURCE_HASH_SCHEME_LEGACY`
 * instead (functionally identical for that case, but the scheme LABEL
 * should never claim a dependency-awareness concept that doesn't apply). */
export const SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES = 'sha256-with-same-file-deps-v1' as const;

export type SourceHashScheme = typeof SOURCE_HASH_SCHEME_LEGACY | typeof SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES;

/** Whether `value` is a scheme THIS version of the checker knows how to
 * re-derive comparable content for — a future scheme this build predates
 * must never be silently treated as one of the two known ones (which could
 * compare a hash against the WRONG notion of "comparable content" and
 * report a false `fresh`/`stale`); callers report `unverifiable` instead
 * for anything this returns `false` for. */
export function isKnownSourceHashScheme(value: string): value is SourceHashScheme {
  return value === SOURCE_HASH_SCHEME_LEGACY || value === SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES;
}

/** A separator between one capability's excerpt and the next in
 * `buildDependencyAwareCanonicalContent()`'s joined output — deliberately
 * NUL-byte-flanked (never realistically part of real source text, unlike a
 * bare newline, which ordinary code already contains plenty of) so two
 * DIFFERENT (capability, dependency-set) combinations can never coincide on
 * the exact same joined string purely because of where one excerpt happened
 * to end and the next began. */
const DEPENDENCY_JOIN_DELIMITER = '\n RAG-DEP-BOUNDARY \n';

/** Every OTHER same-file capability `capability`'s own excerpt actually
 * calls, TRANSITIVELY (capability A calls B, B calls C → C is included too)
 * — a breadth-first walk over `allCapabilities`, using the exact same
 * call-shape detection ragSourceGrounding.ts's own source-grounding
 * validation uses (`hasCallShapedOccurrence()`), so "does X call Y" means
 * the same thing in both places. Cycle-safe (a `visited` set, seeded with
 * `capability` itself so mutual/self-recursion can never loop forever or
 * re-include the root as its own dependency) and BEST-EFFORT for an
 * overloaded name: when two same-file capabilities share a bare `name`
 * (Java overloads), a call-shaped occurrence of that name can't tell which
 * specific overload is meant without real argument-type resolution this
 * pipeline doesn't attempt — EVERY same-named candidate is included rather
 * than guessing, since missing a real dependency (a false "still fresh")
 * is a materially worse outcome here than over-including one (at worst, an
 * UNRELATED overload changing triggers an unnecessary — but never
 * incorrect in the sense of hiding a real change — "stale" report).
 * `whole-file` entries are never considered a dependency (they represent
 * "no split was possible for this file," never a real, individually
 * callable helper). */
/** A stable STRUCTURAL identity for one capability — owner + name +
 * signature — used by `findAllSameFileDependencies()` below to recognize
 * "this is the same real callable" across TWO SEPARATE extraction passes
 * (A09: `capability`, the root, typically comes from the public/capped
 * `extractCapabilities()` list; `allCapabilities` now typically comes from
 * the broader, uncapped `extractAllCallableUnitsForDependencyDiscovery()`
 * list — see that function's own doc comment) rather than plain object
 * IDENTITY, which would only ever recognize "the same object reference,"
 * not "the same real method extracted twice." Without this, a public
 * capability that recursively calls itself (or is simply present, as it
 * always is, in BOTH the narrow root and the broader search-space list)
 * could be mistaken for its own "dependency," duplicating its own excerpt
 * into `buildDependencyAwareCanonicalContent()`'s joined output. */
function capabilityIdentityKey(capability: ExtractedCapability): string {
  return `${capability.ownerClassName ?? ''}::${capability.name}::${capability.signature}`;
}

function findAllSameFileDependencies(capability: ExtractedCapability, allCapabilities: ExtractedCapability[]): ExtractedCapability[] {
  const visitedKeys = new Set<string>([capabilityIdentityKey(capability)]);
  const queue: ExtractedCapability[] = [capability];
  const dependencies: ExtractedCapability[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const other of allCapabilities) {
      if (visitedKeys.has(capabilityIdentityKey(other)) || other.kind === 'whole-file') {
        continue;
      }
      if (hasCallShapedOccurrence(current.excerpt, other.name)) {
        visitedKeys.add(capabilityIdentityKey(other));
        dependencies.push(other);
        queue.push(other);
      }
    }
  }
  return dependencies;
}

/** The exact text `SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES` hashes —
 * `capability`'s own excerpt, followed by every same-file dependency's own
 * excerpt (see `findAllSameFileDependencies()`), each joined by
 * `DEPENDENCY_JOIN_DELIMITER` and sorted by a stable key (naming
 * identifier, then signature) so the result is INDEPENDENT of extraction
 * order — the same "never let a result depend on array/processing order"
 * discipline as ragIndexBuilder.ts's `dedupeRecipeIds()` and
 * ragCapabilityExtraction.ts's `disambiguateCapabilityNames()`. Exported
 * (rather than kept private to `computeDependencyAwareSourceHash()`) so
 * ragFreshnessChecker.ts's `extractComparableContent()` can re-derive the
 * IDENTICAL canonical text from the file's CURRENT content before hashing
 * it — generation and verification must always agree on exactly what text
 * a stored hash covers.
 *
 * `allCapabilities` (A09) should be the file's COMPLETE callable surface —
 * `ragCapabilityExtraction.ts`'s `extractAllCallableUnitsForDependencyDiscovery()`
 * — not the narrower public/capped `extractCapabilities()`/
 * `capabilitiesForFile()` list `capability` itself is typically drawn from.
 * Passing the narrower list here (this function's own original behavior,
 * before A09) silently makes a private/protected Java helper or an
 * underscore-prefixed Python function structurally INVISIBLE to dependency
 * discovery — not merely unlikely to match — so a change to such a helper
 * never affects this hash at all, even though `capability`'s own real
 * behavior depends on it. `findAllSameFileDependencies()`'s own structural
 * (not object-identity) dedup is what makes it safe to pass a SEPARATELY
 * extracted, broader list here even though `capability` came from a
 * different extraction pass. */
export function buildDependencyAwareCanonicalContent(capability: ExtractedCapability, allCapabilities: ExtractedCapability[]): string {
  const dependencies = findAllSameFileDependencies(capability, allCapabilities).sort((a, b) => {
    const aKey = a.namingId ?? a.name;
    const bKey = b.namingId ?? b.name;
    return aKey === bKey ? a.signature.localeCompare(b.signature) : aKey.localeCompare(bKey);
  });
  return [capability.excerpt, ...dependencies.map((d) => d.excerpt)].join(DEPENDENCY_JOIN_DELIMITER);
}

/** SHA-256 of `buildDependencyAwareCanonicalContent()`'s own output — what
 * ragCorpusGenerator.ts stamps as `sourceHash` (alongside
 * `sourceHashScheme: SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES`) for
 * every newly generated per-capability recipe. */
export function computeDependencyAwareSourceHash(capability: ExtractedCapability, allCapabilities: ExtractedCapability[]): string {
  return hashSourceContent(buildDependencyAwareCanonicalContent(capability, allCapabilities));
}

export interface SourceHashInput {
  /** Text ragRecipeNormalizer.ts's `normalizeGeneratedRecipe()` should hash
   * (as its own `sourceRawContent` param) for `sourceHash`. */
  content: string;
  scheme: SourceHashScheme;
}

/** The (content-to-hash, scheme) pair ragCorpusGenerator.ts should stamp
 * for `capability` (F09) — the single decision point dispatching between
 * the two known schemes, kept here (pure, directly tested) rather than in
 * ragCorpusGenerator.ts itself (vscode-dependent orchestration, reviewed
 * rather than unit tested — see that module's own doc comment on "every
 * piece of real decision logic is pulled out into its own pure module").
 *
 * A `'whole-file'` capability keeps the ORIGINAL excerpt-only scheme
 * unchanged — there is no OTHER same-file capability for it to depend on;
 * the whole-file fallback exists precisely because no split was possible
 * (see `capabilitiesForFile()`'s own doc comment) — while a real
 * per-capability generation now hashes that capability's excerpt PLUS
 * every same-file capability it actually calls, transitively, so a change
 * to a same-file helper this capability depends on is no longer invisible
 * to staleness detection.
 *
 * `allCallableUnitsInFile` (A09, renamed from `allCapabilitiesInFile` for
 * this exact reason) should be the file's COMPLETE callable surface — see
 * `buildDependencyAwareCanonicalContent()`'s own doc comment for why the
 * narrower, public/capped list this function used to expect here left
 * private/protected/underscore-prefixed helpers structurally invisible to
 * dependency discovery. */
export function selectSourceHashInput(capability: ExtractedCapability, allCallableUnitsInFile: ExtractedCapability[]): SourceHashInput {
  if (capability.kind === 'whole-file') {
    return { content: capability.excerpt, scheme: SOURCE_HASH_SCHEME_LEGACY };
  }
  return { content: buildDependencyAwareCanonicalContent(capability, allCallableUnitsInFile), scheme: SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES };
}
