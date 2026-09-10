import * as crypto from 'crypto';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { parseRagFile, serializeRagFile, splitFrontmatterBlock } from './ragFrontmatter';
import { RAG_AUTOMATION_MODES, RAG_LANGUAGES, RagFrontmatter, RagFrontmatterSchema } from './ragTypes';
import { buildSourceIdentity, hashSourceContent, SourceHashScheme } from './ragSourceIdentity';

/**
 * Pure post-processing for a Copilot response from "Generate RAG Corpus
 * format" (see ragCorpusGenerator.ts) — deliberately its own file with zero
 * `vscode` import (ragCorpusGenerator.ts itself imports `vscode` for real
 * file-system/model-resolution work, which would make this function
 * untestable outside an Extension Host if it lived there too) so this,
 * the actual "is the model's output usable" logic, is directly unit
 * tested.
 */

export function slugify(fileBaseName: string): string {
  const slug = fileBaseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'component';
}

/** Computes where a generated recipe should be saved under `.github/rag`,
 * preserving the original folder structure when the upload was an entire
 * project/framework zip (see zipReader.ts, ragCorpusGenerator.ts) — a file
 * uploaded at `src/main/java/com/acme/PostgresHelper.java` with
 * `relativePath` `src/main/java/com/acme` lands at
 * `.github/rag/src/main/java/com/acme/postgres-helper.md`, so two
 * same-named helpers from different folders never collide into one file.
 * A directly-dropped single file (no `relativePath`) lands directly under
 * `.github/rag/`, exactly as before this. Every path segment is slugified
 * and `.`/`..` segments are dropped, so this can never traverse outside
 * `.github/rag` regardless of what a zip's internal paths contain. */
export function ragTargetRelPath(fileName: string, relativePath?: string, capabilityName?: string): string {
  const fileSlug = slugify(path.basename(fileName, path.extname(fileName)));
  const baseName = capabilityName ? `${fileSlug}-${slugify(capabilityName)}` : fileSlug;
  const segments = (relativePath || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => slugify(segment));
  return [...segments, `${baseName}.md`].join('/');
}

function shortHash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
}

/** One file offered to `generateRagCorpus()` — the bare minimum needed to
 * both compute its output target AND tell two uploads of the "same" file
 * apart from two merely-same-named ones. `content` is used only to detect
 * a byte-for-byte duplicate upload (see `resolveRagTargets` below), never
 * hashed into the target path itself. */
export interface RagTargetSource {
  fileName: string;
  relativePath?: string;
  content: string;
  /** The specific capability (method/constructor) within `fileName` this
   * source represents — see ragCapabilityExtraction.ts. Undefined for a
   * whole-file source (today's original behavior). Two different
   * capabilities from the SAME file are always distinct sources (never
   * "duplicate"/"conflict" of each other) regardless of how similarly they
   * might otherwise slugify. */
  capabilityName?: string;
}

export type RagTargetStatus =
  /** No other file in this batch maps to the same target — proceed normally. */
  | 'unique'
  /** Byte-for-byte the same fileName + relativePath + content as an earlier
   * entry in the batch (e.g. the same zip entry, or the same file picked
   * twice) — safe to silently skip; it would produce an identical file. */
  | 'duplicate'
  /** Same fileName + relativePath as an earlier entry, but different
   * content — a real conflict (which one is "right"?) that must be
   * reported, never silently resolved by overwriting. */
  | 'conflict';

export interface RagTargetResolution {
  /** `.github/rag`-relative output path this source resolves to, e.g.
   * "src/db/helper-java.md". Two DIFFERENT sources are never given the same
   * path (case-insensitively) — see disambiguation logic below. */
  targetRelPath: string;
  status: RagTargetStatus;
  /** Index into the input array of the earlier entry this is a duplicate of
   * or conflicts with. Present only when status isn't 'unique'. */
  matchesIndex?: number;
}

/** The stable, batch-independent identity string for a source — the exact
 * same value `buildSourceIdentity()` stamps onto a generated recipe's own
 * `sourcePath` frontmatter field, lowercased for case-insensitive
 * comparison (`.github/rag` may be checked out on a case-insensitive
 * filesystem). Two entries with the SAME identity are the same source
 * re-offered (a re-upload, or two identical batch entries) — never a mere
 * naming coincidence. */
function identityKeyOf(f: RagTargetSource): string {
  return buildSourceIdentity(f.fileName, f.relativePath, f.capabilityName).toLowerCase();
}

/**
 * Precomputes an unambiguous source-to-target mapping for an entire upload
 * batch BEFORE any generation/writing happens — the fix for two different
 * inputs silently overwriting each other and both being counted as
 * successes (`helper.java`/`helper.py`, or slug collisions like
 * `foo_bar.py`/`foo-bar.py`, all landing on `helper.md`/`foo-bar.md`).
 *
 * `existingTargetsByIdentity` (optional — see ragCorpusGenerator.ts's
 * caller, which builds it by scanning the CURRENT `.github/rag/**\/*.md`
 * corpus's own `sourcePath` frontmatter) lets a source ALREADY represented
 * in the corpus reuse its own already-assigned target path directly,
 * rather than re-deriving a fresh one from scratch — a name that used to
 * depend on which OTHER files happened to be in this particular batch
 * (re-uploading just `helper.java` alone after a prior batch that also
 * included `helper.py` used to silently produce a NEW `helper.md`,
 * orphaning the old `helper-java.md`) now stays STABLE across batches with
 * different compositions, as long as the source's own identity (fileName +
 * relativePath + capabilityName) hasn't changed. Omit this argument (or
 * pass an empty map) to always derive fresh names, e.g. for a first-ever
 * generation or in tests.
 *
 * Two files whose plain `ragTargetRelPath()` would collide (matched
 * case-insensitively) are disambiguated automatically:
 *  1. If every distinct source in the collision group has a different file
 *     extension, the target is suffixed with that extension
 *     (`helper-java.md`, `helper-py.md`) — still human-readable.
 *  2. Otherwise (extension alone wouldn't distinguish them — e.g. two
 *     `.py` files whose basenames merely slugify the same) every member of
 *     the group is suffixed instead with a short, stable hash of its own
 *     identity — deterministic across runs/order, so the same source
 *     always gets the same id.
 * A FINAL pass then checks the complete set of resolved target paths
 * (fresh AND reused-existing) for any REMAINING cross-group collision —
 * e.g. `helper.java` disambiguating to `helper-java.md` inside one
 * collision group, while an entirely separate file literally named
 * `helper-java.java` naturally resolves to that SAME `helper-java.md` on
 * its own, from a DIFFERENT group that never saw the first collision at
 * all. Per-group disambiguation alone can never catch this — only a check
 * against the complete final set can. Any such residual collision is
 * broken by suffixing every FRESH (never a reused-existing) claimant with
 * a further identity hash, repeated until the whole set is unique.
 *
 * A file whose fileName + relativePath + capabilityName EXACTLY matches an
 * earlier entry IN THIS BATCH is a re-upload of the same source, not a
 * naming collision: identical content is a harmless duplicate (skip it),
 * differing content is a real conflict that must be surfaced rather than
 * silently overwritten.
 */
export function resolveRagTargets(files: RagTargetSource[], existingTargetsByIdentity: ReadonlyMap<string, string> = new Map()): RagTargetResolution[] {
  const baseSlugOf = (f: RagTargetSource) => {
    const fileSlug = slugify(path.basename(f.fileName, path.extname(f.fileName)));
    return f.capabilityName ? `${fileSlug}-${slugify(f.capabilityName)}` : fileSlug;
  };
  const folderOf = (f: RagTargetSource) => {
    const full = ragTargetRelPath(f.fileName, f.relativePath, f.capabilityName);
    const segments = full.split('/');
    return segments.slice(0, -1).join('/');
  };

  // Group indices by folder + base slug (case-insensitive) up front — order-
  // independent, so the same batch always resolves the same way regardless
  // of the order files happen to appear in.
  const collisionGroups = new Map<string, number[]>();
  files.forEach((f, i) => {
    const key = `${folderOf(f).toLowerCase()}::${baseSlugOf(f).toLowerCase()}`;
    const arr = collisionGroups.get(key) ?? [];
    arr.push(i);
    collisionGroups.set(key, arr);
  });

  const results: RagTargetResolution[] = new Array(files.length);
  // Tracks which results (by first-of-group index) came from
  // `existingTargetsByIdentity` — these are NEVER moved during the final
  // global-uniqueness fixup pass below; only freshly-derived names yield.
  const isReusedExisting = new Set<number>();

  for (const indices of collisionGroups.values()) {
    if (indices.length === 1) {
      const i = indices[0];
      const existing = existingTargetsByIdentity.get(identityKeyOf(files[i]));
      if (existing) {
        isReusedExisting.add(i);
      }
      results[i] = { targetRelPath: existing ?? ragTargetRelPath(files[i].fileName, files[i].relativePath, files[i].capabilityName), status: 'unique' };
      continue;
    }

    // Multiple files land on the same base slug in the same folder. First
    // split them by source identity (fileName + relativePath +
    // capabilityName) — repeats of the SAME identity are duplicate
    // uploads, not naming collisions.
    const bySourceIdentity = new Map<string, number[]>();
    for (const i of indices) {
      const key = identityKeyOf(files[i]);
      const arr = bySourceIdentity.get(key) ?? [];
      arr.push(i);
      bySourceIdentity.set(key, arr);
    }

    const distinctIdentities = Array.from(bySourceIdentity.values()).map((group) => group[0]);
    const folder = folderOf(files[distinctIdentities[0]]);
    const baseSlug = baseSlugOf(files[distinctIdentities[0]]);

    // Can the file extension alone tell every distinct source apart?
    const extSlugOf = (i: number) => {
      const ext = path.extname(files[i].fileName).replace(/^\./, '');
      return ext ? slugify(ext) : '';
    };
    const extSlugs = distinctIdentities.map(extSlugOf);
    const extSlugsAreUnique = new Set(extSlugs).size === extSlugs.length && extSlugs.every((s) => s.length > 0);

    for (const first of distinctIdentities) {
      const existing = existingTargetsByIdentity.get(identityKeyOf(files[first]));
      const disambiguator = extSlugsAreUnique ? extSlugOf(first) : shortHash(identityKeyOf(files[first]));
      const targetRelPath = existing ?? (folder ? `${folder}/${baseSlug}-${disambiguator}.md` : `${baseSlug}-${disambiguator}.md`);
      if (existing) {
        isReusedExisting.add(first);
      }

      const group = bySourceIdentity.get(identityKeyOf(files[first]))!;
      group.forEach((i, k) => {
        if (k === 0) {
          results[i] = { targetRelPath, status: 'unique' };
          return;
        }
        const isSameContent = files[i].content === files[first].content;
        results[i] = { targetRelPath, status: isSameContent ? 'duplicate' : 'conflict', matchesIndex: first };
      });
    }
  }

  const occupiedPaths = new Set(Array.from(existingTargetsByIdentity.values()).map((p) => p.toLowerCase()));
  fixResidualCrossGroupCollisions(files, results, isReusedExisting, occupiedPaths);
  return results;
}

/** Sentinel index representing an EXISTING file already on disk (from
 * `occupiedPaths`) that no entry in the current batch owns by identity —
 * never a real index into `files`/`results`. */
const EXISTING_UNRELATED_CLAIMANT = -1;

/** Catches (and deterministically resolves) any target path claimed by
 * more than one DISTINCT identity — either two different sources in THIS
 * batch, or one batch source colliding with a DIFFERENT, unrelated
 * recipe's file already sitting in the corpus (`occupiedPaths`). Per-group
 * disambiguation above only ever compares members WITHIN one collision
 * group, so this is invisible to it either way — two entirely separate
 * groups independently landing on the identical final path (see
 * `resolveRagTargets()`'s own doc comment for the concrete
 * `helper.java`/`helper-java.java` example), or a brand-new source's
 * freshly-derived name happening to coincide with an EXISTING, totally
 * unrelated recipe's own file (which — without this check — would either
 * get silently treated as "this target already exists, confirm overwrite"
 * and clobber that unrelated recipe, or collide invisibly). Mutates
 * `results` in place.
 *
 * Precedence when multiple identities claim the same path:
 *  1. A `isReusedExisting` claimant (this source's OWN prior assignment)
 *     always keeps it, untouched.
 *  2. Otherwise, if an UNRELATED existing file already occupies this path
 *     (`occupiedPaths` contains it and no current entry legitimately owns
 *     it via #1), NO current-batch entry may keep it — every one yields.
 *  3. Otherwise (a pure fresh-vs-fresh collision within this batch), the
 *     first-by-array-order entry keeps it and the rest yield.
 * A `duplicate`/`conflict` entry is never disambiguated directly — it
 * always follows its "first" identity's own representative, propagated
 * automatically when that representative changes. Loops (bounded) since
 * resolving one collision could, in a pathological case, create another —
 * in practice one pass always suffices given the hash disambiguator's
 * effectively-zero collision probability. */
function fixResidualCrossGroupCollisions(files: RagTargetSource[], results: RagTargetResolution[], isReusedExisting: ReadonlySet<number>, occupiedPaths: ReadonlySet<string>): void {
  const MAX_PASSES = 5;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // One representative index per DISTINCT identity that owns a 'unique'
    // result (a 'duplicate'/'conflict' entry shares its identity's own
    // representative's path already, and is skipped here).
    const ownerOf = new Map<string, number[]>(); // lowercased targetRelPath -> claimant indices (EXISTING_UNRELATED_CLAIMANT for an unowned existing file)
    files.forEach((f, i) => {
      if (results[i].status !== 'unique') {
        return;
      }
      const key = results[i].targetRelPath.toLowerCase();
      const arr = ownerOf.get(key) ?? [];
      arr.push(i);
      ownerOf.set(key, arr);
    });
    const reusedPaths = new Set(Array.from(isReusedExisting).map((i) => results[i].targetRelPath.toLowerCase()));
    for (const occupiedPath of occupiedPaths) {
      if (reusedPaths.has(occupiedPath)) {
        continue; // legitimately reused by its own identity — not a phantom collision
      }
      const claimants = ownerOf.get(occupiedPath);
      if (claimants && claimants.length > 0) {
        claimants.push(EXISTING_UNRELATED_CLAIMANT);
      }
    }

    let anyFixed = false;
    for (const claimants of ownerOf.values()) {
      const hasUnrelatedExisting = claimants.includes(EXISTING_UNRELATED_CLAIMANT);
      const batchClaimants = claimants.filter((i) => i !== EXISTING_UNRELATED_CLAIMANT);
      if (batchClaimants.length === 0 || (!hasUnrelatedExisting && batchClaimants.length <= 1)) {
        continue; // no real collision at this path
      }

      const reusedClaimant = batchClaimants.find((i) => isReusedExisting.has(i));
      // Who gets to KEEP this path: a reused-existing claimant always
      // wins; otherwise, if an unrelated existing file already legitimately
      // sits here, NOBODY in this batch may keep it; otherwise the
      // claimant with the LEXICOGRAPHICALLY SMALLEST identity keeps it —
      // deliberately NOT "first in array order," which would make the
      // outcome depend on input array order (this whole module's own
      // stated invariant, see `resolveRagTargets()`'s own doc comment on
      // "the same batch always resolves the same way regardless of order").
      const keepIndex =
        reusedClaimant ??
        (hasUnrelatedExisting ? undefined : [...batchClaimants].sort((a, b) => identityKeyOf(files[a]).localeCompare(identityKeyOf(files[b])))[0]);

      for (const i of batchClaimants) {
        if (i === keepIndex) {
          continue;
        }
        const dir = path.posix.dirname(results[i].targetRelPath);
        const base = path.posix.basename(results[i].targetRelPath, '.md');
        const disambiguated = `${base}-${shortHash(identityKeyOf(files[i]))}.md`;
        const newPath = dir === '.' ? disambiguated : `${dir}/${disambiguated}`;
        // Propagate to every OTHER entry that shares this exact identity
        // (a 'duplicate'/'conflict' pointing its own matchesIndex at `i`)
        // so the whole identity group's targetRelPath stays internally
        // consistent, never leaving a stale value on a follower after its
        // representative was disambiguated here.
        const representative = results[i].matchesIndex ?? i;
        results[representative] = { ...results[representative], targetRelPath: newPath };
        files.forEach((_, j) => {
          if (j !== representative && results[j].matchesIndex === representative) {
            results[j] = { ...results[j], targetRelPath: newPath };
          }
        });
        anyFixed = true;
      }
    }
    if (!anyFixed) {
      return;
    }
  }
}

export function guessLanguageFromExtension(fileName: string): RagFrontmatter['language'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.java') return ['java'];
  if (ext === '.py') return ['python'];
  return [...RAG_LANGUAGES]; // ambiguous (config/script/etc.) — apply to both rather than guess wrong
}

/** Strips a single outer fence wrapping the ENTIRE response, if the model
 * added one despite being told not to (defensive — models don't always
 * follow formatting instructions to the letter). Never touches fences
 * WITHIN the body (the actual example code block), only one that wraps
 * everything including the frontmatter's own "---" delimiters. */
export function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? match[1].trim() : trimmed;
}

export interface NormalizedRecipe {
  /** 'accepted' — the model's response parsed and validated exactly as
   * given, with a non-empty, usable body. 'repaired' — something was wrong
   * (invalid/missing frontmatter fields, or missing frontmatter entirely)
   * but a BOUNDED, purely mechanical fix — reusing only the filename and
   * the schema's own allowed values, never inventing new prose — produced
   * a schema-valid recipe with real usable content; `reason` explains what
   * was fixed, for a human to review. 'rejected' — genuinely unusable
   * (empty, refusal prose, no callable example for a real source file):
   * NOT written into the indexed corpus at all — see
   * ragCorpusGenerator.ts's handling of this status. Schema validity here
   * is NOT the same claim as "verified correct" — 'accepted' means the
   * shape is right and there IS real content, not that the example code
   * actually compiles or the API calls are real; that still needs human
   * review same as any other reusable-component recipe (see ragTypes.ts's
   * own doc comment on this being team-authored, PR-reviewed content). */
  status: 'accepted' | 'repaired' | 'rejected';
  /** The final `.github/rag/*.md`-ready content. Present for 'accepted'
   * and 'repaired'; deliberately `undefined` for 'rejected' so a caller
   * that forgets to check `status` first cannot accidentally end up
   * writing/indexing a rejected response — there is simply nothing here to
   * write. */
  content?: string;
  /** What was repaired ('repaired') or why this was rejected ('rejected').
   * Always present for both non-'accepted' statuses. */
  reason?: string;
}

/** Whether `fileName`'s extension identifies it as REAL source code in one
 * concrete language (`.java`/`.py`) rather than an ambiguous config/script
 * file `guessLanguageFromExtension()` shrugs and applies to both languages.
 * A concrete-language file is expected to produce a genuine, callable
 * helper — its recipe MUST include a fenced code example (checked via
 * `hasCallableContent()`) or there is nothing here worth reusing. An
 * ambiguous file's recipe is more often "how to load/apply this config" —
 * real prose instructions are enough; a code fence isn't required. */
function requiresCallableExample(fileName: string): boolean {
  return guessLanguageFromExtension(fileName).length === 1;
}

function hasCallableContent(text: string): boolean {
  return /```/.test(text);
}

/** Whether `body` is substantial enough to accept as a recipe's content for
 * `fileName` — never empty/whitespace-only, and (for a concrete-language
 * source file specifically) containing at least one fenced code example. */
function isUsableRecipeBody(fileName: string, body: string): boolean {
  if (!body.trim()) {
    return false;
  }
  return requiresCallableExample(fileName) ? hasCallableContent(body) : true;
}

function isValidEnumArray<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && (allowed as readonly string[]).includes(v));
}

/** Attempts ONE bounded, purely mechanical repair of frontmatter that
 * parsed as valid YAML but failed SCHEMA validation — filling in ONLY the
 * specific fields that are actually missing/invalid, using the exact same
 * filename-derived defaults the last-resort fallback below already relies
 * on, and otherwise keeping the model's own values untouched (a model that
 * got `title`/`tags`/`automationMode`/`language` right but botched `id`'s
 * kebab-case shape shouldn't have its correct guesses thrown away too).
 * Returns `undefined` if the parsed YAML isn't even a plain object (there's
 * nothing to repair field-by-field) or if the repaired result STILL fails
 * schema validation. */
function repairFrontmatter(parsedYaml: unknown, fileName: string, capabilityName?: string): RagFrontmatter | undefined {
  if (typeof parsedYaml !== 'object' || parsedYaml === null || Array.isArray(parsedYaml)) {
    return undefined;
  }
  const source = parsedYaml as Record<string, unknown>;
  const baseName = path.basename(fileName, path.extname(fileName));
  // Fold `capabilityName` into the fallback id default — using the bare
  // filename alone (`slugify(baseName)`) here would give every capability
  // in the SAME file (when each independently falls through to this
  // repair path) the identical fallback id, which
  // ragIndexBuilder.ts's `dedupeRecipeIds()` catches at index time (so
  // retrieval can no longer silently drop one), but produces confusing,
  // hash-suffixed ids for what should have been distinguishable by name.
  const fallbackBaseName = capabilityName ? `${baseName}-${capabilityName}` : baseName;
  const candidate: RagFrontmatter = {
    id: typeof source.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(source.id) ? source.id : slugify(fallbackBaseName),
    title: typeof source.title === 'string' && source.title.trim().length > 0 ? source.title : `Reusable component from ${fileName}`,
    tags: Array.isArray(source.tags) && source.tags.every((t) => typeof t === 'string') ? (source.tags as string[]) : [],
    automationMode: isValidEnumArray(source.automationMode, RAG_AUTOMATION_MODES) ? source.automationMode : ['ui', 'api'],
    language: isValidEnumArray(source.language, RAG_LANGUAGES) ? source.language : guessLanguageFromExtension(fileName),
    imports: typeof source.imports === 'object' && source.imports !== null ? (source.imports as RagFrontmatter['imports']) : undefined
  };
  return RagFrontmatterSchema.safeParse(candidate).success ? candidate : undefined;
}

/**
 * Validates the model's raw response as a recipe file. Three outcomes:
 *  - It parses and validates as-is → 'accepted'.
 *  - It doesn't, but is fixable → 'repaired': first tries the bounded,
 *    field-level `repairFrontmatter()` above (when the YAML itself parsed
 *    but schema validation failed); failing that, falls back to wrapping
 *    the model's ENTIRE raw response as the body under minimal
 *    filename-derived frontmatter — but ONLY when there's real usable
 *    content to preserve (`isUsableRecipeBody`), never for empty output or
 *    prose with nothing callable in it.
 *  - Otherwise → 'rejected': an empty/whitespace-only response, a response
 *    with no frontmatter AND no callable content (refusal prose, filler
 *    text), or one whose body is empty even after every repair attempt.
 *    NEVER wrapped as a "broadly applicable" recipe and NEVER indexed —
 *    see ragCorpusGenerator.ts's handling of this status.
 *
 * `sourceRelativePath` (the uploaded file's own path within its project —
 * see ragSourceIdentity.ts) is stamped onto the frontmatter's `sourcePath`
 * field for every non-rejected outcome, UNCONDITIONALLY OVERWRITING
 * whatever the model itself may have put there — this is ground truth this
 * extension already has from the upload itself, never something worth
 * trusting the model to report back accurately (same reasoning as
 * `imports`/`language` needing real verification, not just schema
 * validity — see `NormalizedRecipe`'s own doc comment above). `sourceRawContent`,
 * when given, is likewise hashed and stamped onto `sourceHash` — the
 * provenance half of staleness detection (see ragSourceIdentity.ts's
 * `hashSourceContent()` and ragTypes.ts's `sourceHash` field). Note that
 * `sourceRawContent` is whatever text the CALLER wants THIS hash to cover —
 * as of F09, ragCorpusGenerator.ts passes the dependency-aware CANONICAL
 * content (see ragSourceIdentity.ts's `buildDependencyAwareCanonicalContent()`)
 * for a real capability, not merely its own bare excerpt; this function
 * itself stays agnostic to that and just hashes whatever it's given.
 * `sourceHashScheme`, when given, is stamped alongside `sourceHash`
 * unconditionally overwriting whatever the model itself may have put there
 * (same reasoning as `sourcePath`) — see ragSourceIdentity.ts's
 * `SourceHashScheme` for what it records and why.
 *
 * `sourceMapped` (A07), when given, is stamped alongside `sourcePath`
 * unconditionally the SAME way — the caller (ragCorpusGenerator.ts) has
 * already run the real, vscode-dependent resolution check (this module
 * stays pure/vscode-free) to determine whether `sourcePath` could be
 * confirmed present in some open workspace folder AT THIS MOMENT, and that
 * answer is ground truth, never something to leave unstamped just because
 * this function itself has no way to verify it. See ragTypes.ts's own doc
 * comment on `sourceMapped` for what `true`/`false`/absent each mean to
 * rag/ragFreshnessChecker.ts's later staleness classification.
 */
export function normalizeGeneratedRecipe(
  fileName: string,
  rawResponse: string,
  sourceRelativePath?: string,
  sourceRawContent?: string,
  capabilityName?: string,
  sourceHashScheme?: SourceHashScheme,
  sourceMapped?: boolean
): NormalizedRecipe {
  const sourcePath = buildSourceIdentity(fileName, sourceRelativePath, capabilityName);
  const sourceHash = sourceRawContent !== undefined ? hashSourceContent(sourceRawContent) : undefined;
  // A scheme label is only ever meaningful paired with an actual hash —
  // never stamped on its own (which could misleadingly imply a hash exists
  // when `sourceRawContent` wasn't given at all).
  const stampedScheme = sourceHash !== undefined ? sourceHashScheme : undefined;

  if (!rawResponse.trim()) {
    return { status: 'rejected', reason: 'The model returned an empty (or whitespace-only) response.' };
  }

  // Explicit abstention signal (see prompts/generate-rag-recipe.md's own
  // "never invent an unobservable fact" rule) — the model is told to emit
  // exactly this, instead of a best-effort guess, when the given source
  // excerpt genuinely doesn't show enough to write a usable contract (no
  // observable return shape, precondition, or behavior). Recognized BEFORE
  // any parsing attempt so a deliberate "I don't know" is never confused
  // with, or force-fitted through, the generic malformed-response
  // repair/fallback path below; the model's own stated reason is preserved
  // verbatim for the reviewer.
  const reviewNeededMatch = rawResponse.trim().match(/^REVIEW NEEDED:\s*(.+)$/is);
  if (reviewNeededMatch) {
    return { status: 'rejected', reason: `Model flagged for review: ${reviewNeededMatch[1].trim()}` };
  }

  const candidate = stripOuterFence(rawResponse);
  const parsed = parseRagFile(candidate);
  if (parsed.ok) {
    // Re-serialize rather than saving the model's raw text verbatim — this
    // guarantees the file on disk is byte-for-byte in this extension's own
    // canonical format regardless of the model's own YAML formatting
    // quirks (key order, quoting style, trailing spaces).
    return { status: 'accepted', content: serializeRagFile({ ...parsed.value.frontmatter, sourcePath, sourceHash, sourceHashScheme: stampedScheme, sourceMapped }, parsed.value.body) };
  }

  // parseRagFile failed. If frontmatter is structurally present (opened AND
  // closed with "---") and its YAML itself parses, but SCHEMA validation is
  // what failed, attempt the bounded field-level repair above before
  // resorting to throwing the model's own (possibly otherwise-correct)
  // frontmatter away entirely.
  const structuralSplit = splitFrontmatterBlock(candidate);
  if (structuralSplit) {
    let parsedYaml: unknown;
    try {
      parsedYaml = yaml.load(structuralSplit.yamlBlock);
    } catch {
      parsedYaml = undefined;
    }
    const repaired = parsedYaml !== undefined ? repairFrontmatter(parsedYaml, fileName, capabilityName) : undefined;
    const body = structuralSplit.body.trim();
    if (repaired && isUsableRecipeBody(fileName, body)) {
      return {
        status: 'repaired',
        content: serializeRagFile({ ...repaired, sourcePath, sourceHash, sourceHashScheme: stampedScheme, sourceMapped }, body),
        reason: `Original frontmatter failed validation (${parsed.error}) — repaired the specific invalid field(s) using filename-derived defaults; please review.`
      };
    }
  }

  // Not field-repairable (missing frontmatter entirely, invalid YAML
  // syntax, or a repair that still left no usable body). The LAST resort —
  // wrapping the model's ENTIRE raw response as the body under minimal
  // synthesized frontmatter — is safe only when there's actual usable
  // content to preserve; a response that's just refusal prose or filler
  // text, with nothing callable for a real source file, is not a recipe at
  // all and must be rejected rather than silently indexed as one anyway.
  if (!isUsableRecipeBody(fileName, candidate)) {
    return {
      status: 'rejected',
      reason: `The model's response has no usable content (${parsed.error}${requiresCallableExample(fileName) ? ' — and no fenced code example to fall back to' : ''}).`
    };
  }

  const baseName = path.basename(fileName, path.extname(fileName));
  // Same reasoning as repairFrontmatter()'s own fallbackBaseName above —
  // fold capabilityName in so two different capabilities from the SAME
  // file that BOTH hit this last-resort path don't get the identical
  // filename-derived id.
  const fallbackBaseName = capabilityName ? `${baseName}-${capabilityName}` : baseName;
  const fallbackFrontmatter: RagFrontmatter = {
    id: slugify(fallbackBaseName),
    title: capabilityName ? `Reusable component "${capabilityName}" from ${fileName}` : `Reusable component from ${fileName}`,
    tags: [],
    automationMode: ['ui', 'api'],
    language: guessLanguageFromExtension(fileName),
    sourcePath,
    sourceHash,
    sourceHashScheme: stampedScheme,
    sourceMapped
  };
  return {
    status: 'repaired',
    content: serializeRagFile(fallbackFrontmatter, candidate),
    reason: `Original response was missing/invalid frontmatter (${parsed.error}) — wrapped the model's full response as the body under filename-derived frontmatter; please review.`
  };
}
