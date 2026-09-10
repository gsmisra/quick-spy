import type { ExtractedCapability } from './ragCapabilityExtraction';

/**
 * Source-grounding validation for a per-capability "Generate RAG Corpus
 * format" recipe candidate — separate from (and layered ON TOP of)
 * ragRecipeNormalizer.ts's schema validation. Schema validity only proves
 * the frontmatter/body are STRUCTURALLY well-formed; it says nothing about
 * whether the model actually described the real capability it was given,
 * or quietly drifted onto something else (a hallucinated method, a
 * different class's import path, a body that trails off mid-fence). This
 * module checks the model's OUTPUT against the deterministic facts
 * ragCapabilityExtraction.ts already extracted straight from the real
 * source — the only ground truth this pipeline has.
 *
 * Deliberately pure, zero `vscode` import, directly unit tested. Applies
 * ONLY to the per-capability generation path (where there IS a single,
 * precise capability to check against) — the whole-file fallback path
 * (a file with no capability-level split available) keeps exactly its
 * pre-existing validation, unchanged, for backward compatibility.
 */

export interface SourceGroundingResult {
  ok: boolean;
  /** Present when `ok` is false — a concrete, human-readable reason a
   * reviewer (or ragCorpusGenerator.ts's own draft-quarantine path) can
   * act on. */
  reason?: string;
}

/** Strips an optional `import `/`static import ` prefix and a trailing
 * `;` off a Java import string before checking it against a known
 * package (F05 fix) — `imports.java` is DOCUMENTED (see
 * prompts/generate-rag-recipe.md) to hold bare fully-qualified paths (e.g.
 * "com.acme.db.PostgresHelper", not "import com.acme.db.PostgresHelper;"),
 * but a model doesn't always follow that literally; without this
 * normalization, a model that (harmlessly) emitted a conventional,
 * complete Java import STATEMENT instead of a bare path was rejected by
 * `validateSourceGrounding()`'s own package-prefix check purely because of
 * that wrapper, not because the import was actually wrong. Applied
 * defensively to BOTH sides of any future comparison — a value that never
 * had the wrapper in the first place passes through completely
 * unchanged. */
export function normalizeJavaImportPath(rawImport: string): string {
  return rawImport
    .trim()
    .replace(/^import\s+/, '')
    .replace(/^static\s+/, '')
    .replace(/;\s*$/, '')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- F04 (argument-count verification) --------------------------------------
//
// The gap this section closes: the checks above prove a body calls the
// right NAME on the right OWNER, but say nothing about whether the call
// passes a plausible ARGUMENT COUNT — a fabricated call to the right
// name/owner with the WRONG shape (e.g. the real `find(int id)` called
// instead as `find(name, extra)`) previously passed every check here. This
// section verifies argument COUNT only — never types or order, which would
// need real expression-type inference this deterministic, regex/depth-based
// validator has no way to do reliably without a real risk of FALSE
// rejections (breaking genuinely correct recipes over a validator's own
// misunderstanding of a complex expression). Count alone is still a
// meaningful, cheap, mechanically-verifiable bar: it catches the exact
// review-reported failure mode (an invocation with a plainly wrong number of
// arguments) without pretending to prove full call correctness.

/** Scans forward from `openParenIndex` (which MUST point at a "(") for its
 * matching ")", tracking `()`/`[]`/`{}` nesting depth (never letting a
 * paren/bracket/brace INSIDE a nested call or array/collection literal
 * prematurely end the scan) and skipping over `"..."`/`'...'` literals (with
 * `\`-escape awareness) — the same approach as ragCapabilityExtraction.ts's
 * own `findMatchingBrace()`, adapted to parens, for exactly the same reason:
 * a naive "count parens" scan is defeated the moment an argument contains
 * its own nested call, array/collection literal, or a string literal with a
 * stray `)` inside it. Deliberately does NOT track `<`/`>` here — this
 * function only needs to find the call's own TRUE outer closing paren, and
 * `<`/`>` are never actual parens; that job is unaffected either way. (The
 * separate question of whether `<`/`>` should affect COMMA-splitting once
 * the interior text is extracted is `splitTopLevelSegments()`'s own
 * concern, not this function's.) Returns `undefined` on EOF before depth
 * returns to zero — the caller skips that occurrence rather than guessing
 * at its extent. */
function findMatchingParen(text: string, openParenIndex: number): number | undefined {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j++;
        j++;
      }
      i = j;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}

/** Splits the interior text of an already-extracted parenthesized list
 * (WITHOUT the surrounding parens) into its top-level comma-separated
 * segments — aware of nested `()`/`[]`/`{}` (and, when `trackAngleBrackets`
 * is set, `<>`) and of quoted string/char literals (with `\`-escape
 * handling), so an argument/parameter containing its own comma (a generic
 * type with multiple type arguments, a nested call, an array/collection
 * literal) is never miscounted as more than one segment.
 *
 * `trackAngleBrackets` is used for BOTH a real signature's own DECLARATION
 * parameter list (where `<`/`>` can only ever be a generic type parameter —
 * declaration syntax has no comparison operators, so every `<` genuinely
 * opens a level) and a real CALL's argument list (where `<`/`>` COULD in
 * principle be a comparison operator instead of a generic type-witness/
 * diamond, e.g. `new HashMap<String, Object>()` used as one argument's own
 * value — a real, common shape in illustrative example code, whose own
 * internal comma must NOT be treated as an argument separator, since for an
 * EXACT expected count that would be a false REJECTION, not just harmless
 * extra leniency). To stay safe for both call sites, a `<` only ever opens
 * a tracked level when it immediately follows a word character (a type/
 * identifier name) — `Map<`/`HashMap<` qualify, a bare `a < b` comparison
 * (preceded by whitespace) does not. This is a heuristic, not a real
 * parser — a `<` written with no preceding space in a genuine comparison
 * (rare in this kind of example code) could still be mistaken for opening a
 * generic; documented, accepted risk, favoring "avoid a false rejection on
 * common declaration-and-call shapes" over "handle every conceivable
 * expression style." Returns `[]` for an all-whitespace/empty interior (a
 * genuine zero-argument call or zero-parameter signature), never `['']`. */
function splitTopLevelSegments(interior: string, trackAngleBrackets: boolean): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < interior.length; i++) {
    const ch = interior[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      current += ch;
      let j = i + 1;
      while (j < interior.length && interior[j] !== quote) {
        if (interior[j] === '\\' && j + 1 < interior.length) {
          current += interior[j];
          j++;
        }
        current += interior[j];
        j++;
      }
      if (j < interior.length) {
        current += interior[j];
      }
      i = j;
      continue;
    }
    // A "<" only opens a tracked generic-diamond level when it immediately
    // follows a word character (a type/identifier name, e.g. "Map<...>" or
    // "HashMap<...>") — never for a bare "<" preceded by whitespace/an
    // operator position (e.g. "a < b"), which is far more likely a
    // comparison than a generic in the kind of illustrative example code
    // this validates. This asymmetry matters: an UN-recognized generic
    // diamond containing its own comma (e.g. "new HashMap<String, Object>()"
    // used as one argument's own value) would otherwise split into TWO
    // segments instead of one — for an EXACT expected count (min === max)
    // that's a real false REJECTION, not just extra leniency, so this
    // heuristic isn't optional polish, it's load-bearing for correctness.
    const opensGeneric = trackAngleBrackets && ch === '<' && i > 0 && /\w/.test(interior[i - 1]);
    const isOpen = ch === '(' || ch === '[' || ch === '{' || opensGeneric;
    const isClose = ch === ')' || ch === ']' || ch === '}' || (trackAngleBrackets && ch === '>');
    if (isOpen) {
      depth++;
    } else if (isClose) {
      depth = Math.max(0, depth - 1); // never go negative — a stray/ambiguous closer must never poison the rest of the scan
    }
    if (ch === ',' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  const trimmed = segments.map((s) => s.trim());
  return trimmed.length === 1 && trimmed[0] === '' ? [] : trimmed;
}

/** Every argument COUNT found for a call-shaped occurrence of `name` in
 * `body` (same call-shape anchoring as `hasCallShapedOccurrence()` above —
 * `name(` or `.name(`) whose argument list could actually be parsed to a
 * real closing paren. An occurrence whose closing paren couldn't be located
 * (an unclosed/unparseable shape) is silently skipped here — NOT treated as
 * "zero arguments" — since `checkArgumentCount()` below must never reject
 * based on a guess about text it couldn't actually parse. */
function findCallArgumentCounts(body: string, name: string): number[] {
  const pattern = new RegExp(`(?:^|[.\\s(])${escapeRegExp(name)}\\s*\\(`, 'g');
  const counts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findMatchingParen(body, openParenIndex);
    if (closeParenIndex === undefined) {
      pattern.lastIndex = openParenIndex + 1; // still make forward progress past this unparseable occurrence
      continue;
    }
    counts.push(splitTopLevelSegments(body.slice(openParenIndex + 1, closeParenIndex), true).length);
    pattern.lastIndex = closeParenIndex + 1;
  }
  return counts;
}

export interface ArgumentCountRange {
  min: number;
  max: number; // Infinity when the declaration accepts an unbounded tail (Java varargs, Python *args/**kwargs)
}

function isJavaVarArgsSegment(segment: string): boolean {
  return segment.includes('...');
}

/** Derives the valid argument-count RANGE from a Java method/constructor
 * signature's own parameter-list text (the substring between its first
 * `(`/matching `)` — Java signatures never have an earlier, unrelated paren
 * to confuse this with, since neither modifiers nor a return type can
 * contain one). Java has no default-argument syntax, so every non-varargs
 * parameter is always required; a trailing `Type... name` varargs parameter
 * (the only repetition mechanism Java has) makes the max unbounded and its
 * own slot optional (zero or more). */
function deriveJavaExpectedArgumentRange(paramListText: string): ArgumentCountRange {
  const segments = splitTopLevelSegments(paramListText, true);
  if (segments.length === 0) {
    return { min: 0, max: 0 };
  }
  const hasVarArgs = isJavaVarArgsSegment(segments[segments.length - 1]);
  const fixedCount = hasVarArgs ? segments.length - 1 : segments.length;
  return { min: fixedCount, max: hasVarArgs ? Infinity : fixedCount };
}

/** Derives the valid argument-count RANGE from a Python `def` signature's
 * own parameter-list text. Unlike Java: (1) a bound method/constructor call
 * NEVER passes `self`/`cls` explicitly (it's supplied implicitly by
 * `instance.method(...)` / `Class.method(...)` call syntax) — stripped here
 * so the expected range matches what a CORRECT call site actually looks
 * like, not the raw declaration; (2) a parameter with a `= default` is
 * OPTIONAL, lowering `min` without lowering `max`; (3) a bare `*`/`*args`/
 * `**kwargs` marker makes the max unbounded, since the call may legally
 * supply any number of further positional/keyword arguments. */
function derivePythonExpectedArgumentRange(paramListText: string, hasOwner: boolean): ArgumentCountRange {
  let segments = splitTopLevelSegments(paramListText, false);
  if (hasOwner && segments.length > 0 && /^(self|cls)\b/.test(segments[0])) {
    segments = segments.slice(1);
  }
  if (segments.length === 0) {
    return { min: 0, max: 0 };
  }
  let unbounded = false;
  let positionalCount = 0;
  let optionalCount = 0;
  for (const segment of segments) {
    if (segment.startsWith('*')) {
      // "*args", "**kwargs", or a bare "*" keyword-only marker — any of
      // these means the call may legally supply more arguments than the
      // fixed positional parameters alone would suggest.
      unbounded = true;
      continue;
    }
    positionalCount++;
    if (segment.includes('=')) {
      optionalCount++;
    }
  }
  return { min: Math.max(0, positionalCount - optionalCount), max: unbounded ? Infinity : positionalCount };
}

/** Extracts a signature's own parameter-list text (the substring strictly
 * between its first `(` and that paren's matching `)`) and derives the
 * expected argument-count range from it — dispatching Java-vs-Python by the
 * signature's own recognizable shape (a Java method/constructor signature
 * captured by this pipeline always starts with `public`; a Python `def`
 * line always starts with `def` or, for a coroutine function (F03),
 * `async def` — by construction of ragCapabilityExtraction.ts's own two
 * extraction paths — never a guess about the SOURCE file's real language,
 * since these are the only recognizable shapes extraction ever produces).
 * Returns `undefined` when the signature doesn't match any recognizable
 * shape, or has no parenthesized parameter list at all — callers must
 * treat this as "cannot verify," never as "zero parameters." */
function deriveExpectedArgumentRange(capability: ExtractedCapability): ArgumentCountRange | undefined {
  const signature = capability.signature;
  const openParenIndex = signature.indexOf('(');
  if (openParenIndex === -1) {
    return undefined;
  }
  const closeParenIndex = findMatchingParen(signature, openParenIndex);
  if (closeParenIndex === undefined) {
    return undefined;
  }
  const paramListText = signature.slice(openParenIndex + 1, closeParenIndex);
  const trimmedSignature = signature.trimStart();
  if (trimmedSignature.startsWith('def ') || trimmedSignature.startsWith('async def ')) {
    return derivePythonExpectedArgumentRange(paramListText, Boolean(capability.ownerClassName));
  }
  if (trimmedSignature.startsWith('public ')) {
    return deriveJavaExpectedArgumentRange(paramListText);
  }
  return undefined; // an unrecognized shape — never guess at a language-specific parsing rule
}

/** Whether `body` contains at least one call-shaped occurrence of
 * `capability.name` whose argument COUNT falls inside the range its own
 * real signature allows — see this section's own top-level doc comment for
 * what this does and does not verify. Fails OPEN (returns `ok: true`)
 * whenever the expected range can't be derived, or every occurrence's own
 * argument list couldn't be parsed to a real closing paren — "couldn't
 * verify" must never be reported as "verified wrong." When at least one
 * occurrence WAS successfully parsed and NONE fall in range, this is a
 * real, actionable mismatch — a call to the right name/owner with a
 * plainly wrong number of arguments, exactly the review-reported gap this
 * section exists to close. */
function checkArgumentCount(body: string, capability: ExtractedCapability): SourceGroundingResult {
  const expected = deriveExpectedArgumentRange(capability);
  if (!expected) {
    return { ok: true };
  }
  const observedCounts = findCallArgumentCounts(body, capability.name);
  if (observedCounts.length === 0) {
    return { ok: true }; // every occurrence was unparseable — nothing to verify against, never a guessed failure
  }
  const anyInRange = observedCounts.some((count) => count >= expected.min && count <= expected.max);
  if (anyInRange) {
    return { ok: true };
  }
  const expectedLabel = expected.max === Infinity ? `at least ${expected.min}` : expected.min === expected.max ? `exactly ${expected.min}` : `${expected.min}–${expected.max}`;
  const observedLabel = Array.from(new Set(observedCounts)).sort((a, b) => a - b).join(', ');
  return {
    ok: false,
    reason:
      `"${capability.name}" expects ${expectedLabel} argument(s) per its real signature ("${capability.signature}"), but every call-shaped occurrence in the generated body passed a different count ` +
      `(observed: ${observedLabel}) — this looks like a fabricated invocation with the wrong argument shape, not a genuine usage of this capability.`
  };
}

/** Whether `body` contains an actual CALL-shaped occurrence of `name` —
 * `name(` or `.name(`, word-boundary-anchored so e.g. "findAll(" never
 * satisfies a check for "find" (F04 fix). A bare substring match (the
 * OLD check) was satisfied by the name merely appearing ANYWHERE, in any
 * shape — including inside ordinary prose (e.g. "This find helper is
 * unavailable." contains "find") or a fabricated signature/reference that
 * never actually calls anything real. Requiring a real call shape is a
 * meaningfully higher, still cheap and deterministic, bar — though still
 * not a guarantee the call's OWNER/parameters are correct (see
 * `validateSourceGrounding()`'s own doc comment on real, remaining
 * limits).
 *
 * KNOWN, historically real gap (A02): this shape is ALSO satisfied by a
 * capability's own "API:" DECLARATION line (e.g. "public int find(int
 * id)" — a return type, a space, then "find(" is textually identical to a
 * real call's own shape) — a bare `hasCallShapedOccurrence(body, name)`
 * check run against the WHOLE recipe body could therefore be satisfied by
 * the declaration alone, with no real invocation example anywhere. Callers
 * needing to confirm a genuine EXAMPLE call (not just this shape appearing
 * somewhere) must run this against `extractFencedExampleCode()`'s own
 * output instead of the raw body — see `validateSourceGrounding()` for
 * exactly that usage.
 *
 * Exported for reuse by ragSourceIdentity.ts's own dependency-aware
 * hashing (F09) — determining which OTHER same-file capability a given
 * capability's excerpt actually calls uses this exact same call-shape
 * detection, rather than a second, potentially-drifting copy of it (that
 * usage scans real SOURCE code, which has no "declaration vs. example"
 * distinction to worry about — the gap above is specific to a GENERATED
 * recipe body's own two-part shape). */
export function hasCallShapedOccurrence(body: string, name: string): boolean {
  return new RegExp(`(?:^|[.\\s(])${escapeRegExp(name)}\\s*\\(`).test(body);
}

/** Extracts the concatenated CONTENT of every complete fenced (```...```)
 * code block in a generated recipe `body`, in source order, joined by
 * newlines — never the surrounding prose or the "API:" declaration line,
 * which per generate-rag-recipe.md's own required format always live
 * OUTSIDE any fence. Returns `undefined` when there are zero fenced
 * blocks, or every one of them is blank once trimmed — a recipe whose body
 * is just prose/the bare declaration, with no actual invocation example at
 * all (A02's second reproduced bug: "correct API metadata plus Owner
 * mention" used to pass validation with NOTHING resembling a real example
 * anywhere). Assumes an EVEN fence count — callers must run the existing
 * odd-fence-count check first; an unclosed fence is a different, already-
 * handled failure mode, not "no example." */
function extractFencedExampleCode(body: string): string | undefined {
  const fencePattern = /```[^\n]*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(body)) !== null) {
    blocks.push(match[1]);
  }
  const joined = blocks.join('\n');
  return joined.trim().length > 0 ? joined : undefined;
}

/** Every RECEIVER token immediately preceding a `.name(` call shape inside
 * `exampleCode` — e.g. `["Finder"]` for `Finder.find(1)`, or
 * `["postgresHelper"]` for `postgresHelper.queryOne(sql)`. A BARE call
 * (`find(1)`, no receiver at all — e.g. a static-import-style usage)
 * contributes nothing here; see `dottedReceiverMatchesOwner()`'s own doc
 * comment for how that shape is handled instead. */
function findDottedReceivers(exampleCode: string, name: string): string[] {
  const pattern = new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\.\\s*${escapeRegExp(name)}\\s*\\(`, 'g');
  const receivers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(exampleCode)) !== null) {
    receivers.push(match[1]);
  }
  return receivers;
}

function lowercaseFirst(text: string): string {
  return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Whether `exampleCode` establishes that `receiver` actually refers to an
 * instance of `ownerClassName` — a LOCAL BINDING, not just a name-shape
 * coincidence: Python/generic `receiver = OwnerClassName(...)` (an
 * assignment from a constructor-shaped call), or Java's declared-type
 * forms `OwnerClassName receiver = ...` / `var receiver = new
 * OwnerClassName(...)`. This is what makes the extremely common,
 * genuinely correct pattern `helper = PostgresHelper()` /
 * `helper.query_one(sql)` (a generic instance-variable name that is
 * neither the class name itself nor its lowercased-first-letter
 * rendering) pass — real code overwhelmingly uses names like `helper`,
 * `client`, `db`, `conn`, not the class name reused as the variable name,
 * and a receiver check that only recognized the latter two shapes would
 * reject the common case, not just the fabricated one this section exists
 * to catch. */
function receiverIsBoundToOwner(exampleCode: string, receiver: string, ownerClassName: string): boolean {
  const escapedReceiver = escapeRegExp(receiver);
  const escapedOwner = escapeRegExp(ownerClassName);
  const constructorAssignment = new RegExp(`\\b${escapedReceiver}\\s*=\\s*(?:new\\s+)?${escapedOwner}\\s*\\(`);
  const declaredType = new RegExp(`\\b${escapedOwner}\\s+${escapedReceiver}\\b`);
  return constructorAssignment.test(exampleCode) || declaredType.test(exampleCode);
}

/** A02 fix (part 2): whether the example's ACTUAL call site(s) are
 * consistent with the real owner — closing the reproduced gap where a
 * fenced example calls a completely fabricated receiver (e.g.
 * "Fake.find(1)") while the real owner ("Helper") is only ever mentioned
 * in disconnected prose elsewhere in the body, which the OLD
 * whole-body-substring owner check couldn't tell apart from a genuine
 * usage.
 *
 * Returns:
 *  - `true` when at least one DOTTED occurrence of `name` in `exampleCode`
 *    has a receiver that's consistent with the real owner — the exact
 *    class name (a static-style call, e.g. `Finder.find(...)`), that name
 *    with its first letter lowercased (`finder`/`postgresHelper` for
 *    `Finder`/`PostgresHelper`), OR a receiver `receiverIsBoundToOwner()`
 *    confirms was actually constructed/declared as an instance of the
 *    real owner earlier in the SAME example (covers any other legitimate
 *    instance-variable name — `helper`, `client`, `db`, ...).
 *  - `false` when at least one dotted occurrence exists and NONE of them
 *    satisfy any of the above — a real, actionable "fabricated receiver"
 *    signal.
 *  - `undefined` when there is NO dotted occurrence to judge at all (only
 *    bare, receiver-less call(s), e.g. a legitimate static-import-style
 *    `find(...)`) — deliberately NOT a verdict either way; the caller
 *    falls back to a coarser whole-body owner-MENTION check for this
 *    shape, since there is no local call-site evidence to judge from and
 *    Java static imports are a real, legitimate reason a call can
 *    correctly have no receiver at all.
 *
 * Still not a full binding/type-inference proof — a receiver introduced
 * through a getter, a field access, a framework-provided fixture, or
 * anything else this deterministic scan doesn't recognize is not verified
 * either way (never rejected on that basis alone, since `false` requires
 * every dotted occurrence to have been checked and none confirmed — see
 * `validateSourceGrounding()`'s own doc comment on this remaining
 * limit). */
function dottedReceiverMatchesOwner(exampleCode: string, name: string, ownerClassName: string): boolean | undefined {
  const receivers = findDottedReceivers(exampleCode, name);
  if (receivers.length === 0) {
    return undefined;
  }
  const instanceStyle = lowercaseFirst(ownerClassName);
  return receivers.some((receiver) => receiver === ownerClassName || receiver === instanceStyle || receiverIsBoundToOwner(exampleCode, receiver, ownerClassName));
}

/** Validates a generated recipe body against the specific capability it
 * was supposed to describe:
 *  1. Every fenced code block in the body must be complete (an even
 *     number of ``` delimiters) — an unclosed fence means the example is
 *     truncated or malformed, not a usable invocation. Checked FIRST since
 *     nothing below can reliably extract example code from a malformed
 *     fence shape anyway.
 *  2. The body must contain at least one fenced code block with real,
 *     non-blank content at all (A02 fix) — a recipe consisting of only the
 *     "API:"/"Use:"/"Requires:" prose and NO actual invocation example is
 *     rejected here, rather than silently accepted as if a description
 *     were as good as a real, verifiable example.
 *  3. That example code (never the surrounding prose, and never the "API:"
 *     declaration line itself — see `extractFencedExampleCode()`'s own doc
 *     comment on why the declaration's own textual shape is otherwise
 *     indistinguishable from a real call) must contain an actual
 *     CALL-SHAPED occurrence of the capability's own name (`name(` or
 *     `.name(`) — not merely the name appearing anywhere in the body as a
 *     substring (the OLD, much weaker check, satisfied even by ordinary
 *     prose like "This find helper is unavailable." or by the declaration
 *     line alone).
 *  4. When the real owner class is known, the example's ACTUAL call
 *     site(s) must be consistent with it (A02 fix, `dottedReceiverMatchesOwner()`)
 *     — a call with an EXPLICIT receiver that matches neither the real
 *     class name nor its usual instance-variable rendering is rejected
 *     outright, catching a fabricated invocation on an invented receiver
 *     (e.g. "Fake.find(1)" when the real owner is "Helper" and the ONLY
 *     mention of "Helper" is disconnected prose elsewhere in the body —
 *     the OLD whole-body-substring check couldn't tell this apart from a
 *     genuine usage). A BARE call with no receiver at all (a legitimate
 *     static-import-style usage, e.g. Java's `import static X.find;` then
 *     a bare `find(1)`) has no local call-site evidence to judge, so this
 *     falls back to the coarser whole-BODY owner-mention check for that
 *     one shape only — an intentional, narrower carve-out, not a re-
 *     opening of the general gap this fix closes.
 *  5. For Java, when the source's own package is known: if the recipe
 *     declares ANY `imports.java`, at least one of them must actually
 *     start with that real package (normalized via
 *     `normalizeJavaImportPath()` so a conventional full `import x.y.Z;`
 *     statement is compared fairly, not just a bare path) — catching the
 *     case where the model invents or misremembers an import path instead
 *     of using the one this pipeline already handed it as ground truth
 *     (see ragSourceIdentity.ts's `extractJavaPackageDeclaration()` and
 *     ragCorpusGenerator.ts's prompt construction). Python has no
 *     equivalent deterministic check here — see ragSourceIdentity.ts's own
 *     doc comment on why a Python module path can't be verified the same
 *     way from file content alone; that gap is covered by requiring the
 *     model to omit `imports.python` entirely when it can't establish a
 *     reliable path (generate-rag-recipe.md's own instruction), not by a
 *     mechanical check here.
 *  6. The example code's call-shaped occurrence(s) of the capability's own
 *     name must include at least one whose argument COUNT falls within
 *     the range its real signature allows (`checkArgumentCount()`, F04's
 *     second fix, now scoped to the example code only — A02) — catching a
 *     fabricated invocation of the right owner/name with an implausible
 *     argument shape (e.g. the real `find(int id)` called instead as
 *     `find(name, extra)`). Fails OPEN (never rejects) whenever the
 *     expected range or the call's own argument list can't be reliably
 *     parsed — see that function's own doc comment for exactly what it
 *     does and does not attempt.
 *
 * KNOWN, DELIBERATELY UNIMPLEMENTED gaps: check 6 verifies argument COUNT
 * only — never TYPES or ORDER. Check 4's receiver check is a heuristic
 * (exact class name or its lowercased-first-letter instance-variable
 * rendering only) — a receiver bound through an unusually-named local
 * variable, a getter call, or similar indirection is not verified either
 * way (never rejected on that basis alone, but also not confirmed
 * correct). Neither gap is something real expression-level type/binding
 * inference — which this deterministic, regex/depth-based validator has no
 * reliable way to do without a real risk of FALSE rejections — would be
 * needed to close; future work, not something this function's current
 * checks imply is covered.
 *
 * None of these checks are a PROOF the recipe is semantically correct —
 * only that it didn't fail these specific, mechanically-verifiable facts.
 * A recipe passing this is still team-authored, PR-reviewed content like
 * any other (see ragTypes.ts's own doc comment), not verified-correct
 * code. */
export function validateSourceGrounding(
  body: string,
  javaImports: string[] | undefined,
  capability: ExtractedCapability,
  javaPackage: string | undefined
): SourceGroundingResult {
  const fenceCount = (body.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) {
    return { ok: false, reason: 'The generated body has an unclosed fenced code block.' };
  }

  const exampleCode = extractFencedExampleCode(body);
  if (!exampleCode) {
    return {
      ok: false,
      reason: 'The generated body has no fenced code example at all — a compact calling contract must show at least one real invocation, not just the "API:" declaration or a description.'
    };
  }

  if (!hasCallShapedOccurrence(exampleCode, capability.name)) {
    return {
      ok: false,
      reason: `The generated contract's own example never shows an actual CALL to "${capability.name}(" (or ".${capability.name}(") — the capability it was supposed to describe. A bare mention of the name in prose, or in the "API:" declaration alone, is not enough.`
    };
  }

  // A02 fix: verify the example's ACTUAL call site is consistent with the
  // real owner, not just that the owner's name appears SOMEWHERE in the
  // body — see `dottedReceiverMatchesOwner()`'s own doc comment for the
  // exact rule and its one deliberate carve-out (a bare, receiver-less
  // call falls back to the coarser whole-body mention check, since there's
  // no local call-site evidence to judge for that legitimate shape).
  if (capability.ownerClassName) {
    const receiverMatch = dottedReceiverMatchesOwner(exampleCode, capability.name, capability.ownerClassName);
    if (receiverMatch === false) {
      return {
        ok: false,
        reason: `The example's actual call to "${capability.name}(" uses a receiver that matches neither the real owner class "${capability.ownerClassName}" nor its usual instance-variable rendering — this looks like a fabricated or different receiver, not a genuine usage.`
      };
    }
    if (receiverMatch === undefined && !body.includes(capability.ownerClassName)) {
      return {
        ok: false,
        reason: `The generated contract never mentions "${capability.ownerClassName}" — the real owner class of "${capability.name}" — suggesting the example may call a fabricated or different receiver instead.`
      };
    }
  }

  if (javaPackage && javaImports && javaImports.length > 0) {
    const hasRealPackageImport = javaImports.some((imp) => normalizeJavaImportPath(imp).startsWith(`${javaPackage}.`));
    if (!hasRealPackageImport) {
      return {
        ok: false,
        reason: `None of the declared Java import(s) (${javaImports.join(', ')}) match the source file's own package ("${javaPackage}").`
      };
    }
  }

  return checkArgumentCount(exampleCode, capability);
}
