import * as crypto from 'crypto';

/**
 * Deterministic, best-effort extraction of individual CALLABLE capabilities
 * (public methods, constructors, top-level functions) out of one Java or
 * Python source file — the foundation of "Generate RAG Corpus format"
 * generating one compact recipe per capability instead of one recipe per
 * whole file. Deliberately pure, zero `vscode` import, so this is directly
 * unit-testable.
 *
 * This is regex + brace/indentation scanning, NOT a real parser — this
 * codebase has deliberately avoided adding an AST-parsing dependency
 * everywhere else (see tfidfEmbeddings.ts's own doc comment on the same
 * "no model/parser download" philosophy for RAG), and a real Java/Python
 * grammar is a much bigger dependency than that trade-off justifies here.
 * That means REAL, DOCUMENTED gaps: multi-line method signatures, generics
 * with nested angle brackets in unusual positions, annotations that split a
 * signature across lines, lambda-heavy bodies, and Python code using tabs
 * inconsistently with spaces can all cause a capability to be MISSED
 * (never a wrong one FABRICATED — every extracted signature/excerpt is a
 * verbatim slice of the real source, so a bug here means "this method
 * wasn't found," not "this method's signature is wrong"). When extraction
 * finds ZERO capabilities in a `.java`/`.py` file, ragCorpusGenerator.ts
 * falls back to treating the whole file as one capability, exactly like
 * before this feature existed — extraction failing is never a hard error.
 *
 * F03 fixes (nested/multiple classes get the right OWNER, `async def` is no
 * longer silently missed, a function nested inside another function is
 * recognized as non-independently-callable and excluded rather than
 * fabricated as its own capability) are documented at their own call
 * sites below — `findJavaClassRanges()`/`ownerClassForPosition()` and
 * `findPythonScopeDecls()`/`nearestEnclosingScope()`.
 */

export interface ExtractedCapability {
  /** The callable's own name — a method/function name, or the class name
   * itself for a constructor/`__init__`. For a 'whole-file' capability
   * (see `capabilitiesForFile()` below), the file's own base name — NOT a
   * real callable, never used for a target filename/source-identity
   * suffix the way a real capability name is. */
  name: string;
  kind: 'method' | 'constructor' | 'whole-file';
  /** The class this capability belongs to — undefined for a Python
   * top-level function (Java always has an owner; a file with no
   * recognizable class produces zero Java capabilities). */
  ownerClassName?: string;
  /** The exact signature line(s) as they appear in source, trimmed —
   * shown to the model as ground truth for what to describe, never
   * re-derived or guessed at. */
  signature: string;
  /** The capability's own full body, INCLUDING its signature line (and,
   * for Python, any immediately preceding decorator lines) — a verbatim
   * slice of the real source, given to the model as READ-ONLY context to
   * understand behavior/preconditions. The generation prompt explicitly
   * forbids reproducing this in the recipe's own output; it exists only to
   * inform the compact contract's intent/prerequisites fields. */
  excerpt: string;
  /** The identifier to use for NAMING purposes (target filename,
   * `sourcePath`'s `#capabilityName` suffix — see ragSourceIdentity.ts's
   * `buildSourceIdentity()`) — set ONLY when this capability's plain
   * `name` collides with another capability in the SAME file, in either
   * of TWO ways: (1) the SAME owner, same name — a real Java method
   * overload, e.g. `find(int)` and `find(String)`, disambiguated by a
   * hash of its own signature; or (2) DIFFERENT owners, same bare name
   * (A05 fix) — e.g. `class A: def run()` and `class B: def run()` in one
   * Python file, disambiguated by the owner's own name instead, since a
   * signature hash would work but convey nothing a reviewer could
   * recognize at a glance. `name` itself is NEVER changed — it stays the
   * real callable name used in the model's own generated contract text;
   * only this naming-specific identifier gets a discriminator appended,
   * so two colliding capabilities never collapse onto the same target
   * file or the same `sourcePath` (which previously made
   * `resolveRagTargets()` in ragRecipeNormalizer.ts report a spurious
   * content CONFLICT between two entirely valid, different capabilities —
   * for case (2), one of them would simply fail to generate at all).
   * `undefined` when `name` alone is already unique within this file —
   * callers must use `namingId ?? name`. See
   * `disambiguateCapabilityNames()`'s own doc comment for exactly how
   * this is computed. */
  namingId?: string;
}

/** Raised from 20 to 100 — a real, reported gap: a genuinely common
 * "big enterprise framework utility class" (e.g. a REST-assured request
 * builder with two dozen-plus fluent setter methods) was hitting the old
 * cap and having some of its own real, valid public methods silently
 * excluded from generation (surfaced via `countDeferredCapabilities()`'s
 * own "N additional method(s)... were NOT generated" message, but still an
 * artificial ceiling on a legitimate file). Kept as a real, finite cap
 * (never removed outright) rather than unbounded — generation is
 * deliberately SEQUENTIAL, one real Copilot call per capability (see
 * ragCorpusGenerator.ts's own generation loop), so an unbounded cap would
 * let a truly pathological file (an auto-generated stub with hundreds of
 * trivial one-line methods) trigger an extremely long, uninterruptible
 * generation run with no warning at all — 100 is generous enough to cover
 * essentially any realistically-sized real class while still catching that
 * genuinely degenerate case and reporting it via
 * `countDeferredCapabilities()`, same as before. */
export const MAX_CAPABILITIES_PER_FILE = 100;

/** Short, stable, deterministic disambiguator derived from a capability's
 * own real signature (never from processing order/index) — two overloads
 * of the same name always get the SAME two distinct suffixes regardless of
 * extraction order. Collision-avoidance only, not security-sensitive — SHA-1
 * is fine, same posture as ragRecipeNormalizer.ts's own `shortHash()`. */
function shortSignatureHash(signature: string): string {
  return crypto.createHash('sha1').update(signature).digest('hex').slice(0, 6);
}

/** Assigns `namingId` (see `ExtractedCapability`'s own doc comment) to
 * every capability whose plain `name` collides with ANOTHER capability in
 * `capabilities` (the same file's own extraction result) — in either of
 * TWO distinct ways:
 *
 *  1. The SAME owner, same name — a real overload (e.g. Java's
 *     `find(int)`/`find(String)` on the SAME class) — disambiguated by a
 *     hash of its own real signature, exactly as before this fix (F02's
 *     original behavior, unchanged).
 *  2. DIFFERENT owners, same bare name, same file (A05 fix) — e.g.
 *     `class A: def run()` and `class B: def run()`: neither collides
 *     with the OTHER at the owner-scoped level (`disambiguateCapabilityNames()`'s
 *     OLD check alone correctly leaves both with `namingId: undefined`),
 *     but ragCorpusGenerator.ts's `capabilityNameForNaming()` folds
 *     EVERY capability down to `namingId ?? name` for target-path/
 *     `sourcePath` purposes — so two capabilities that are genuinely
 *     DIFFERENT (different owner, different real behavior) still
 *     collapsed onto the IDENTICAL naming identity the moment neither had
 *     a `namingId`, reported as a spurious content CONFLICT by
 *     `resolveRagTargets()` (ragRecipeNormalizer.ts) — one of the two
 *     legitimate capabilities would simply fail to generate. Disambiguated
 *     here by the OWNER's own name — the natural, stable, meaningful fact
 *     distinguishing two capabilities that merely happen to share a bare
 *     name, unlike a signature hash (case 1's own disambiguator), which
 *     would work but convey nothing a reviewer could recognize at a
 *     glance. Never applies when `ownerClassName` is unknown (a top-level
 *     function has no owner to disambiguate by; two same-named top-level
 *     functions in one file are already a compile error in both Java and
 *     Python, so this shape can't actually occur from real source).
 *
 * EVERY colliding occurrence gets a suffix under whichever case applies
 * (never leaves exactly one bare "winner" by extraction order, the same
 * "no result depends on array order" discipline as
 * ragIndexBuilder.ts's `dedupeRecipeIds()`). A capability whose bare name
 * is unique across the WHOLE file needs neither check and is returned
 * completely UNTOUCHED — `namingId` stays `undefined`, so every existing,
 * already-generated recipe's naming/`sourcePath` convention for the
 * overwhelming common (non-colliding) case is entirely unaffected by this
 * fix. */
function disambiguateCapabilityNames(capabilities: ExtractedCapability[]): ExtractedCapability[] {
  const countByOwnerScopedKey = new Map<string, number>();
  const countByBareName = new Map<string, number>();
  for (const capability of capabilities) {
    const ownerScopedKey = `${capability.ownerClassName ?? ''}::${capability.name}`;
    countByOwnerScopedKey.set(ownerScopedKey, (countByOwnerScopedKey.get(ownerScopedKey) ?? 0) + 1);
    countByBareName.set(capability.name, (countByBareName.get(capability.name) ?? 0) + 1);
  }
  return capabilities.map((capability) => {
    const ownerScopedKey = `${capability.ownerClassName ?? ''}::${capability.name}`;
    if ((countByOwnerScopedKey.get(ownerScopedKey) ?? 0) > 1) {
      return { ...capability, namingId: `${capability.name}-${shortSignatureHash(capability.signature)}` };
    }
    if ((countByBareName.get(capability.name) ?? 0) > 1 && capability.ownerClassName) {
      return { ...capability, namingId: `${capability.ownerClassName}-${capability.name}` };
    }
    return capability;
  });
}

/** A09: when `true`, extraction also recognizes an EXPLICITLY
 * private/protected Java method/constructor (never a bare, unmarked
 * package-private one — see `JAVA_METHOD_PATTERN_ANY_VISIBILITY`'s own doc
 * comment for why that narrower scope is a deliberate, documented safety
 * choice) and does NOT skip an underscore-prefixed Python function —
 * i.e. every REAL callable this best-effort scanner can find at all, not
 * just the ones `extractCapabilities()` would offer up for actual recipe
 * GENERATION. Used ONLY by `extractAllCallableUnitsForDependencyDiscovery()`
 * below — recipe generation itself (`extractCapabilities()`,
 * `capabilitiesForFile()`) always uses `false` here, completely unchanged. */
interface ExtractAllCapabilitiesOptions {
  includeNonPublic?: boolean;
}

function extractAllCapabilities(fileName: string, content: string, options: ExtractAllCapabilitiesOptions = {}): ExtractedCapability[] {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  const includeNonPublic = options.includeNonPublic ?? false;
  return ext === '.java' ? extractJavaCapabilities(content, includeNonPublic) : ext === '.py' ? extractPythonCapabilities(content, includeNonPublic) : [];
}

/** Dispatches by file extension — `.java` and `.py` get real (best-effort)
 * extraction; every other extension returns an empty list, which callers
 * (ragCorpusGenerator.ts) treat as "no capability-level split available,
 * generate one recipe for the whole file instead," exactly like before
 * this feature existed. Caps the result at `MAX_CAPABILITIES_PER_FILE` —
 * each capability becomes one real LLM call, so an unusually large utility
 * class shouldn't silently explode into dozens of requests; the excess is
 * simply not extracted (never a partial/wrong extraction, never silently
 * dropped without a trace either — see `countDeferredCapabilities()`
 * below, which a caller can use to actually SURFACE how many were left
 * out, rather than this cap being invisible), and a caller that wants
 * coverage of the rest can re-run generation after splitting the source
 * file itself. */
export function extractCapabilities(fileName: string, content: string): ExtractedCapability[] {
  return disambiguateCapabilityNames(extractAllCapabilities(fileName, content).slice(0, MAX_CAPABILITIES_PER_FILE));
}

/** How many REAL capabilities `extractCapabilities()` found but did NOT
 * return, purely because of the `MAX_CAPABILITIES_PER_FILE` cap — `0` when
 * everything found fit within the cap (the overwhelming common case), or
 * when nothing was found at all. ragCorpusGenerator.ts uses this to
 * actually TELL a user "N additional method(s) in this file were not
 * generated — split it and re-upload the rest" instead of the cap being a
 * silent, untraceable cutoff. Re-runs extraction (cheap — this is regex
 * scanning over one already-in-memory file, not an LLM call) rather than
 * threading a second return value through `extractCapabilities()` itself,
 * which would have changed that function's return shape for every
 * existing caller/test. */
export function countDeferredCapabilities(fileName: string, content: string): number {
  return Math.max(0, extractAllCapabilities(fileName, content).length - MAX_CAPABILITIES_PER_FILE);
}

/** Like `extractCapabilities()`, but NEVER returns an empty list. When no
 * capability-level split is available — a non-Java/Python file (a config/
 * data file has no single "callable" in this sense), or a `.java`/`.py`
 * file where extraction genuinely found nothing (e.g. only private
 * methods, or a shape this best-effort scanner doesn't recognize) — this
 * returns a single SYNTHETIC `kind: 'whole-file'` capability representing
 * the entire file as one unit, so ragCorpusGenerator.ts can run every file
 * through the exact same per-capability generation pipeline instead of
 * maintaining two separate code paths. Callers MUST treat a `'whole-file'`
 * capability's `name` as informational only — never fold it into a target
 * filename or source-identity suffix the way a real capability name is
 * (see ragCorpusGenerator.ts's own handling), so a config/ambiguous file's
 * recipe naming stays byte-for-byte identical to before this feature
 * existed. */
export function capabilitiesForFile(fileName: string, content: string): ExtractedCapability[] {
  const extracted = extractCapabilities(fileName, content);
  if (extracted.length > 0) {
    return extracted;
  }
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return [{ name: baseName, kind: 'whole-file', signature: fileName, excerpt: content }];
}

/** A09: the COMPLETE same-file search space for same-file DEPENDENCY
 * discovery (ragSourceIdentity.ts's `findAllSameFileDependencies()`) —
 * deliberately SEPARATE from `capabilitiesForFile()`/`extractCapabilities()`,
 * which stay exactly as they were (public-only, capped at
 * `MAX_CAPABILITIES_PER_FILE`, disambiguated for target-naming purposes).
 * Before this existed, a PUBLIC capability's dependency-aware source hash
 * (`sha256-with-same-file-deps-v1`) could only ever "see" other PUBLIC,
 * within-the-cap capabilities as candidate dependencies — a private/
 * protected Java helper, an underscore-prefixed Python function, or any
 * real capability past the 20-per-file cap was structurally invisible to
 * the dependency search, not merely unlikely to match: changing such a
 * helper's OWN behavior (e.g. a private `adjust(id)` going from `id + 1`
 * to `id + 99`) left the public caller's stored hash byte-for-byte
 * unchanged, silently reporting a genuinely-changed recipe as still
 * `fresh` (a real, reproduced gap — see the F09/A09 review's own repro).
 *
 * Returns EVERY real callable this best-effort scanner can find at all
 * (`includeNonPublic: true` — see that option's own doc comment for the
 * exact, deliberately conservative scope: an EXPLICITLY private/protected
 * Java method/constructor, or an underscore-prefixed Python function —
 * never a bare, unmarked package-private Java method, which would drop
 * the strong `public`/`private`/`protected` keyword anchor this scanner's
 * safety against false-positive matches on ordinary code lines like `else
 * if (x) {` depends on), UNCAPPED (a helper the 21st+ generated capability
 * depends on must remain discoverable exactly as freely as one within the
 * cap), and NOT disambiguated (`namingId` is a target-naming concern for
 * actual recipe generation only — irrelevant to walking a call graph by
 * bare name, and computing it over this broader set would risk changing
 * an EXISTING public capability's own naming purely because of an
 * unrelated private helper sharing its bare name, which must never
 * happen).
 *
 * Still a real, honestly-documented gap even after this fix: field/state
 * reads and import-level dependencies are NOT tracked (this scanner has no
 * notion of either — see this module's own top-level doc comment on being
 * regex/brace-scanning, not a real parser) — only call-shaped dependencies
 * on another same-file callable. A change to a field's own declaration (or
 * a class-level constant) that a capability reads, with no corresponding
 * change to any callable, remains invisible to `sha256-with-same-file-deps-v1`,
 * exactly as it always has been. */
export function extractAllCallableUnitsForDependencyDiscovery(fileName: string, content: string): ExtractedCapability[] {
  return extractAllCapabilities(fileName, content, { includeNonPublic: true });
}

/** Scans forward from `openBraceIndex` (which MUST point at a `{`) for its
 * matching `}`, tracking nesting depth while skipping over `//` line
 * comments, `/* *\/` block comments, and `"..."`/`'...'` literals (with
 * `\`-escape awareness) — a plain "count braces" scan would miscount the
 * moment a string literal contains a `{` or `}` of its own (common in
 * Java, e.g. `String s = "{}"`), which is common enough in real code that
 * skipping it is worth the extra complexity. Returns `undefined` if EOF is
 * reached before the depth returns to zero (malformed/truncated input, or
 * a shape this scanner doesn't handle) — the caller skips that one
 * capability rather than guessing at its extent. */
function findMatchingBrace(content: string, openBraceIndex: number): number | undefined {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '/' && content[i + 1] === '/') {
      const nextNewline = content.indexOf('\n', i);
      i = nextNewline === -1 ? content.length : nextNewline;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      i = end === -1 ? content.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < content.length && content[j] !== quote) {
        if (content[j] === '\\') {
          j++; // skip the escaped character too
        }
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

/** Public methods matching `public [modifiers...] ReturnType name(params) {`
 * on ONE line ending in `{` — a real limitation (a signature split across
 * multiple lines, or ending with `throws ...` on its own line, is missed;
 * see this module's own doc comment). Requires TWO identifier-shaped
 * tokens before the parenthesis (return type, then name), which is what
 * naturally excludes constructors (`public ClassName(` has only one) from
 * matching here — see `CONSTRUCTOR_PATTERN` below for those instead. */
const JAVA_METHOD_PATTERN =
  /^[ \t]*public\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?[\w[\]<>,.\s]+?\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;

/** `public ClassName(params) {` — exactly one identifier before the
 * parenthesis, which is only ever true for a constructor in valid Java (a
 * method always has an explicit return type, `void` included, as a
 * SEPARATE token before its name). Filtered further by the caller to only
 * keep matches where the captured name equals the enclosing class's own
 * name. */
const JAVA_CONSTRUCTOR_PATTERN = /^[ \t]*public\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;

/** A09: the SAME shape as `JAVA_METHOD_PATTERN`, but requiring
 * `private`/`protected` (in addition to `public`) instead of `public`
 * alone — used ONLY for dependency discovery
 * (`extractAllCallableUnitsForDependencyDiscovery()`), never for actual
 * recipe generation. Deliberately does NOT also match a bare,
 * unmarked package-private method (no modifier keyword at all): the
 * explicit `public`/`private`/`protected` keyword is what lets this
 * pattern anchor safely at the start of a line without also matching an
 * ordinary control-flow-shaped statement — e.g. "else if (x) {" has no
 * modifier keyword at all, so requiring one keeps that (and similar
 * shapes) from ever being misdetected as a callable. An entirely
 * unmarked package-private helper remains a real, documented gap even
 * after this fix. */
const JAVA_METHOD_PATTERN_ANY_VISIBILITY =
  /^[ \t]*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?[\w[\]<>,.\s]+?\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;

/** A09: the `private`/`protected` (in addition to `public`) counterpart of
 * `JAVA_CONSTRUCTOR_PATTERN` — see `JAVA_METHOD_PATTERN_ANY_VISIBILITY`'s
 * own doc comment for why an unmarked package-private constructor is still
 * out of scope. */
const JAVA_CONSTRUCTOR_PATTERN_ANY_VISIBILITY = /^[ \t]*(?:public|private|protected)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/gm;

/** Every `class Name` declaration in the file, global (not anchored to
 * line-start, matching the pre-existing single-match pattern this replaces
 * — see this module's own doc comment on the accepted, pre-existing risk
 * of a bare "class" substring appearing inside a string/line-comment that
 * isn't itself masked out). Deliberately does NOT try to also match
 * `interface`/`enum`/`record` — a Java `record` in particular declares its
 * fields as CONSTRUCTOR-shaped parameters, not a `class` body, and is left
 * as a documented future gap, same posture as everything else this
 * best-effort scanner doesn't attempt. */
const JAVA_CLASS_NAME_PATTERN = /\bclass\s+(\w+)/g;

interface JavaClassRange {
  name: string;
  /** Index of the "class" keyword itself. */
  start: number;
  /** Index of this class body's own matching closing `}`. */
  end: number;
}

/** Every class declaration's own full extent (F03 fix — nested/multiple
 * classes), so a method/constructor can be attributed to the SPECIFIC
 * class it actually lives inside rather than a single file-wide guess. The
 * OLD code took just the FIRST `class` match in the whole file and used
 * that ONE name as `ownerClassName` for every extracted method — wrong the
 * moment a file declares more than one class (an inner/nested class being
 * the common real-world case: `public class Outer { public static class
 * Inner { ... } }`), since every one of `Inner`'s own methods would be
 * mislabeled as belonging to `Outer`. Scans forward from each class name to
 * its own opening `{` (skipping over `extends`/`implements`/generic-bound
 * clauses in between, whatever they contain) and uses `findMatchingBrace()`
 * to find that SAME class's own closing `}` — giving each class declaration
 * a real `[start, end]` extent that `ownerClassForPosition()` below can
 * test containment against. A class declaration with no locatable opening
 * brace, or an unmatched one, is skipped (never guessed at) — same "skip,
 * don't guess" posture as `tryExtract()`'s own unparseable-extent handling. */
function findJavaClassRanges(maskedContent: string, realContent: string): JavaClassRange[] {
  const ranges: JavaClassRange[] = [];
  for (const match of maskedContent.matchAll(JAVA_CLASS_NAME_PATTERN)) {
    const name = match[1];
    const declEnd = match.index + match[0].length;
    const openBraceIndex = maskedContent.indexOf('{', declEnd);
    if (openBraceIndex === -1) {
      continue;
    }
    const closeBraceIndex = findMatchingBrace(realContent, openBraceIndex);
    if (closeBraceIndex === undefined) {
      continue;
    }
    ranges.push({ name, start: match.index, end: closeBraceIndex });
  }
  return ranges;
}

/** The INNERMOST class range containing `position` — among every class
 * range that actually CONTAINS `position` (its `[start, end]` span), the
 * one with the LATEST `start` is the most deeply nested one (a nested
 * class's own declaration necessarily starts AFTER its enclosing class's
 * declaration, and ends before or with it) — the same "most recent
 * declaration wins" containment rule ragCorpusGenerator.ts-adjacent
 * Python owner detection below already uses, generalized to real
 * start/end EXTENTS rather than just a line/indent comparison (Java has no
 * significant indentation to lean on the way Python does). `undefined`
 * when `position` isn't inside any known class at all (a top-level
 * function-shaped construct Java doesn't actually have at the method
 * level, so this is mostly a defensive fallback). */
function ownerClassForPosition(position: number, classRanges: JavaClassRange[]): string | undefined {
  let best: JavaClassRange | undefined;
  for (const range of classRanges) {
    if (position >= range.start && position <= range.end && (!best || range.start > best.start)) {
      best = range;
    }
  }
  return best?.name;
}

/** Replaces every `/* ... *\/` block comment's INTERIOR with spaces
 * (newlines preserved, so every other character's index stays identical
 * to `content`) — used ONLY to decide where a real signature starts, never
 * to compute an excerpt's actual text (`tryExtract()` always slices the
 * ORIGINAL `content`, using the SAME indices this masked copy reports,
 * since masking never shifts anything). Without this, example code shown
 * inside a Javadoc block comment (e.g. `/** Example: public void foo() {
 * ... } *\/`) can be mistaken for a REAL, callable method — the "excerpt"
 * handed to the model as ground truth would then be commented-out/
 * illustrative text, not actual source. Line comments (`//`) need no such
 * treatment: both signature patterns anchor at the very start of a line
 * (`^[ \t]*public...`), and a line starting with `//` can never also start
 * with `public` at that same position. */
function maskJavaBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function extractJavaCapabilities(content: string, includeNonPublic = false): ExtractedCapability[] {
  // Signature/class-name MATCHING only ever runs against this masked copy
  // — extent-finding/excerpt-slicing below always uses the real `content`.
  // The class-name detection needs this exactly as much as method/
  // constructor detection does — a class declaration shown inside a
  // Javadoc example (e.g. "/** public class FakeExample { ... } */") would
  // otherwise be mistaken for a real owning class.
  const maskedForMatching = maskJavaBlockComments(content);
  // F03 fix: EVERY class declaration's own extent, not just the file's
  // first one — see `findJavaClassRanges()`'s own doc comment for why a
  // single file-wide guess mis-attributes every method of a nested/inner
  // class to its OUTER class instead.
  const classRanges = findJavaClassRanges(maskedForMatching, content);
  const capabilities: ExtractedCapability[] = [];
  const claimedRanges: Array<[number, number]> = [];

  const tryExtract = (match: RegExpExecArray, name: string, kind: ExtractedCapability['kind'], ownerClassName: string | undefined): void => {
    const openBraceIndex = match.index + match[0].length - 1;
    const closeBraceIndex = findMatchingBrace(content, openBraceIndex);
    if (closeBraceIndex === undefined) {
      return; // unparseable extent — skip this one, never guess
    }
    const excerpt = content.slice(match.index, closeBraceIndex + 1).trim();
    const signature = match[0].slice(0, match[0].length - 1).trim(); // drop the trailing "{"
    capabilities.push({ name, kind, ownerClassName, signature, excerpt });
    claimedRanges.push([match.index, closeBraceIndex]);
  };

  // A09: dependency discovery (includeNonPublic) uses the broader
  // ANY_VISIBILITY patterns — see their own doc comments for exactly what
  // additional (and what still NOT) visibility shape each recognizes.
  const methodPattern = includeNonPublic ? JAVA_METHOD_PATTERN_ANY_VISIBILITY : JAVA_METHOD_PATTERN;
  const constructorPattern = includeNonPublic ? JAVA_CONSTRUCTOR_PATTERN_ANY_VISIBILITY : JAVA_CONSTRUCTOR_PATTERN;

  for (const match of maskedForMatching.matchAll(methodPattern)) {
    tryExtract(match, match[1], 'method', ownerClassForPosition(match.index, classRanges));
  }
  // F03 fix: a constructor's owner is now its OWN innermost enclosing
  // class (never the file's single first-found class) — this also makes a
  // NESTED class's own constructor extractable at all, which the old
  // single-file-wide-`ownerClassName` check (`if (ownerClassName) { ... }`,
  // run once for the whole file) would otherwise have silently skipped
  // whenever a nested class's name differed from the file's outer one.
  for (const match of maskedForMatching.matchAll(constructorPattern)) {
    const owner = ownerClassForPosition(match.index, classRanges);
    if (owner && match[1] === owner) {
      tryExtract(match, match[1], 'constructor', owner);
    }
  }

  // Sort by source order (matchAll for two separate patterns interleaves
  // method/constructor discovery order, not source order) so a recipe's
  // own numbering/logging reads top-to-bottom like the file itself.
  return capabilities
    .map((cap, i) => ({ cap, start: claimedRanges[i][0] }))
    .sort((a, b) => a.start - b.start)
    .map(({ cap }) => cap);
}

// F03 fix: an optional "async " prefix — the OLD pattern matched only a
// plain "def ...", silently MISSING every `async def` coroutine function
// entirely (never a wrong extraction, just a whole class of real,
// independently-callable capabilities never found at all — the same
// "missed capability" failure mode the whole-file fallback exists to be
// resilient against, but which shouldn't be needed for something this
// mechanical to just recognize).
const PYTHON_DEF_PATTERN = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/;
const PYTHON_CLASS_PATTERN = /^([ \t]*)class\s+([A-Za-z_]\w*)\s*[:(]/;

function pythonLineIndent(line: string): number {
  return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

/** One `class` or `def`/`async def` declaration's own line/indent — used
 * to find, for any given line, its NEAREST enclosing declaration (F03
 * fix): the most recent one (by line) that is both BEFORE it and LESS
 * indented. Tracking `def` declarations here too (not just `class`, as the
 * OLD code did) is what lets `extractPythonCapabilities()` below tell a
 * real METHOD (nearest enclosing declaration is a class) apart from a
 * NESTED function (nearest enclosing declaration is ANOTHER function) —
 * the latter is a private implementation detail of its enclosing
 * function, not independently callable from outside it, and the OLD code
 * had no way to recognize that shape at all: it would extract a nested
 * `def` exactly like a real top-level function or method, fabricating a
 * "capability" a generated recipe could show calling directly even though
 * that call would never actually work from outside the enclosing
 * function's own scope. */
interface PythonScopeDecl {
  kind: 'class' | 'def';
  name: string;
  indent: number;
  line: number;
}

function findPythonScopeDecls(lines: string[]): PythonScopeDecl[] {
  const decls: PythonScopeDecl[] = [];
  for (let i = 0; i < lines.length; i++) {
    const classMatch = lines[i].match(PYTHON_CLASS_PATTERN);
    if (classMatch) {
      decls.push({ kind: 'class', name: classMatch[2], indent: classMatch[1].length, line: i });
      continue;
    }
    const defMatch = lines[i].match(PYTHON_DEF_PATTERN);
    if (defMatch) {
      decls.push({ kind: 'def', name: defMatch[2], indent: defMatch[1].length, line: i });
    }
  }
  return decls;
}

function nearestEnclosingScope(indent: number, line: number, decls: PythonScopeDecl[]): PythonScopeDecl | undefined {
  let best: PythonScopeDecl | undefined;
  for (const decl of decls) {
    if (decl.line < line && decl.indent < indent && (!best || decl.line > best.line)) {
      best = decl;
    }
  }
  return best;
}

function extractPythonCapabilities(content: string, includeNonPublic = false): ExtractedCapability[] {
  const lines = content.split(/\r?\n/);
  const scopeDecls = findPythonScopeDecls(lines);

  const capabilities: ExtractedCapability[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PYTHON_DEF_PATTERN);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    const name = match[2];
    const isInit = name === '__init__';
    // A09: dependency discovery (includeNonPublic) does NOT skip an
    // underscore-prefixed ("private by convention") function — a public
    // capability calling straight into `_helper()` is exactly the shape
    // this exists to make discoverable at all; recipe generation itself
    // (includeNonPublic: false) is completely unaffected.
    if (!includeNonPublic && name.startsWith('_') && !isInit) {
      continue; // private-by-convention — not a callable a test should reach for
    }

    // F03 fix: a function nested inside ANOTHER function (its nearest
    // enclosing scope is a `def`, not a `class`) is a private
    // implementation detail of that enclosing function — never
    // independently callable from outside it — and is never extracted as
    // its own capability. A function whose nearest enclosing scope is a
    // CLASS (a real method) or nothing at all (a real top-level function)
    // is unaffected — this is strictly narrower than the old
    // classes-only check, never broader.
    const enclosing = nearestEnclosingScope(indent, i, scopeDecls);
    if (enclosing?.kind === 'def') {
      continue;
    }

    // Body: every following line more indented than the def itself (blank
    // lines tolerated in between), up to the first line back at or below
    // the def's own indentation.
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) {
        continue;
      }
      if (pythonLineIndent(lines[j]) <= indent) {
        end = j;
        break;
      }
    }

    // Include immediately preceding decorator line(s) at the SAME
    // indentation (e.g. @staticmethod) — they change the calling
    // convention, so they matter for an accurate excerpt.
    let start = i;
    while (start > 0 && lines[start - 1].trim().startsWith('@') && pythonLineIndent(lines[start - 1]) === indent) {
      start--;
    }

    const excerpt = lines.slice(start, end).join('\n').trimEnd();
    capabilities.push({
      name,
      kind: isInit ? 'constructor' : 'method',
      ownerClassName: enclosing?.kind === 'class' ? enclosing.name : undefined,
      signature: lines[i].trim(),
      excerpt
    });
  }
  return capabilities;
}
