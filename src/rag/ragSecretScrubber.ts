/**
 * Deterministic secret scrubbing for a "Generate RAG Corpus format" recipe
 * candidate, right before it's written to `.github/rag/` — the missing
 * check the current corpus route relied on a PROMPT INSTRUCTION alone for
 * ("never reproduce a real secret" — see prompts/generate-rag-recipe.md's
 * rule about it), which is advisory, not enforced: a model that ignores or
 * misreads that instruction (or copies a secret embedded in the SOURCE
 * file it was analyzing) had nothing stopping the real value from landing
 * in a file this extension then commits to source control and re-sends to
 * an LLM on every future generation.
 *
 * Deliberately pure, zero `vscode` import, so this is directly unit
 * tested. Reuses the SAME two detection shapes
 * security/chatInstructionRedactor.ts already established for the chat-box
 * free-text gap (connection-string embedded credentials, and
 * `label: value`/`label = value` pairs against a secret-field vocabulary)
 * — the patterns themselves are duplicated here rather than imported,
 * since chatInstructionRedactor.ts's own import of secretVault.ts pulls in
 * a `vscode` dependency transitively, which would make this file
 * untestable outside an Extension Host (the same reason
 * llm/tokenBudget.ts and panel/ragTraceabilityBanner.ts are their own
 * files this session). Keep this file's two patterns in sync with
 * secretVault.ts's `SECRET_FIELD_PATTERN` and
 * chatInstructionRedactor.ts's `CONNECTION_STRING_CREDENTIAL_PATTERN` by
 * hand if either changes.
 *
 * DETERMINISTIC REDACTION, not encryption: unlike Auto Password
 * Encryption's `ENC[v1:...]` tokens (which exist so GENERATED, EXECUTED
 * test code can decrypt a real credential at run time), a `.github/rag/`
 * recipe is inert reference text — nothing ever decrypts it, it's only
 * ever re-embedded into a future prompt verbatim. There is no legitimate
 * reason for a real secret value to survive in it at all, encrypted or
 * not, so a detected value is replaced with a plain `<REDACTED>`
 * placeholder instead.
 */

const SECRET_FIELD_PATTERN = /password|passwd|\bpwd\b|passphrase|secret|credential|\bpin\b|api[-_]?key|auth[-_]?token/i;

const CONNECTION_STRING_CREDENTIAL_PATTERN = /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/g;

const REDACTED_PLACEHOLDER = '<REDACTED>';

// --- A03 (type annotations are not secret values) ---------------------------
//
// The gap this section closes: a Python TYPE ANNOTATION (`name: Type`) and a
// real "label: value" credential pair (`password: hunter2`) are the exact
// same textual shape — a label, a colon, a bare token — to a regex that
// can't tell a type name from an assigned value apart. The OLD single-regex
// approach (`LABEL_VALUE_PATTERN`, replaced by this section) always treated
// whatever came right after `label:` as "the value," so
// `def login(password: str, user: str):` had its OWN TYPE ANNOTATION
// corrupted into `password: <REDACTED>` — never a real secret to begin
// with. Worse: for `password: str = "REAL_SECRET"` (a typed parameter WITH
// a default), the old regex's bare-value match stopped at the first
// whitespace and consumed ONLY "str" — leaving the REAL secret after `=`
// completely untouched, the opposite of what this scrubber exists to do.
// A generic type with brackets (`Optional[str]`) made this worse still: the
// old bare-value character class excluded `]` (to avoid swallowing an
// ENCLOSING array/object literal's own closing bracket — a real, separate
// concern), which truncated the type's own closing bracket mid-token,
// corrupting the signature into invalid syntax.

const PYTHON_BUILTIN_TYPE_NAMES = new Set([
  'str', 'int', 'float', 'bool', 'bytes', 'bytearray', 'complex', 'list', 'dict', 'tuple', 'set', 'frozenset', 'object', 'None',
  'Any', 'Optional', 'Union', 'List', 'Dict', 'Tuple', 'Set', 'FrozenSet', 'Callable', 'Iterable', 'Iterator', 'Sequence', 'Mapping', 'Type'
]);

/** Whether `baseName` (an identifier with any dotted module-path prefix
 * already stripped, e.g. "Optional" from "typing.Optional") looks like a
 * REAL Python type name rather than an assigned value — ONLY the fixed,
 * known builtin/typing-module vocabulary, deliberately NOT "starts with
 * an uppercase letter" (PascalCase, the tempting next-broadest signal): a
 * genuinely common convention for a FAKE/EXAMPLE secret VALUE is ALSO
 * capitalized (`SuperSecret123`, `MyP@ssword`, ...), so that heuristic
 * would let real secrets leak through completely untouched — a materially
 * worse outcome than this section's whole reason for existing. In real
 * code, a parameter whose NAME matches `SECRET_FIELD_PATTERN` (password,
 * token, api_key, ...) is overwhelmingly annotated with a builtin or
 * typing-module type (`str`, `Optional[str]`, ...), essentially never a
 * custom class — restricting recognition to this fixed vocabulary
 * therefore covers the realistic case without opening a new leak vector.
 * A genuinely custom secret-shaped type annotation (e.g. pydantic's
 * `SecretStr`) that isn't in this list is treated as a VALUE and
 * redacted — a rare false positive, but a SAFE one (over-redaction is
 * this whole module's own accepted, documented tradeoff — see its
 * top-of-file doc comment), never the reverse. */
function looksLikePythonTypeName(baseName: string): boolean {
  return PYTHON_BUILTIN_TYPE_NAMES.has(baseName);
}

/** Attempts to consume ONE well-formed Python type-annotation token
 * starting at `text[start]` — an identifier (optionally dotted, e.g.
 * `typing.Optional`), optionally followed by a BRACKET-DEPTH-BALANCED
 * `[...]` generic parameter list, so `Dict[str, List[int]]` is consumed as
 * ONE unit rather than truncated at its first `]` (unlike the old
 * character-class-based bare-value match this replaces). Returns the
 * index just PAST the consumed token, or `undefined` when there's no
 * identifier at `start` at all, its own bracket group is unbalanced
 * (never guess at malformed input), or its base name doesn't look like a
 * real type name (`looksLikePythonTypeName()`) — a lowercase, non-builtin
 * token like `hunter2` is deliberately NOT consumed here, falling through
 * to being treated as a real value to redact, exactly as before this
 * fix. */
function matchPythonTypeAnnotationEnd(text: string, start: number): number | undefined {
  const identifierMatch = /^[A-Za-z_][\w.]*/.exec(text.slice(start));
  if (!identifierMatch) {
    return undefined;
  }
  const identifier = identifierMatch[0];
  const baseName = identifier.split('.').pop()!;
  if (!looksLikePythonTypeName(baseName)) {
    return undefined;
  }
  let end = start + identifier.length;
  if (text[end] === '[') {
    let depth = 0;
    let i = end;
    for (; i < text.length; i++) {
      if (text[i] === '[') {
        depth++;
      } else if (text[i] === ']') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) {
      return undefined; // unbalanced brackets — never guess at malformed input
    }
    end = i;
  }
  return end;
}

interface ConsumedValue {
  /** The (possibly redacted) text to splice back in for this value. */
  text: string;
  /** Index in the ORIGINAL string just past the consumed value. */
  end: number;
  scrubbed: boolean;
}

/** Consumes and (if it's a real credential-shaped value, never a
 * placeholder/already-encrypted token) redacts ONE quoted-or-bare value
 * starting at `text[start]` — the same three shapes (double-quoted,
 * single-quoted, bare) `LABEL_VALUE_PATTERN` used to match in one regex
 * alternation, now a plain scan so `scrubLabelValuePairs()` below can call
 * it from two different call sites (the plain `label = value` / `label:
 * value` case, and the `label: Type = value` typed-default case) without
 * duplicating this logic. The bare branch stops at whitespace or any of
 * `,;)}]` — never just whitespace alone (F07's own original fix, preserved
 * here unchanged) — those are exactly the characters that immediately
 * follow a parameter/value in real code, and swallowing one into the
 * redacted span would corrupt the surrounding syntax the same way this
 * whole section exists to stop happening for type annotations. */
function consumeAndRedactValue(text: string, start: number): ConsumedValue {
  const rest = text.slice(start);
  const doubleQuoted = /^"([^"]*)"/.exec(rest);
  if (doubleQuoted) {
    const value = doubleQuoted[1];
    const end = start + doubleQuoted[0].length;
    if (!value || value === REDACTED_PLACEHOLDER || value.startsWith('ENC[')) {
      return { text: doubleQuoted[0], end, scrubbed: false };
    }
    return { text: `"${REDACTED_PLACEHOLDER}"`, end, scrubbed: true };
  }
  const singleQuoted = /^'([^']*)'/.exec(rest);
  if (singleQuoted) {
    const value = singleQuoted[1];
    const end = start + singleQuoted[0].length;
    if (!value || value === REDACTED_PLACEHOLDER || value.startsWith('ENC[')) {
      return { text: singleQuoted[0], end, scrubbed: false };
    }
    return { text: `'${REDACTED_PLACEHOLDER}'`, end, scrubbed: true };
  }
  const bare = /^[^\s,;)}\]]+/.exec(rest);
  if (bare) {
    const value = bare[0];
    const end = start + value.length;
    if (!value || value === REDACTED_PLACEHOLDER || value.startsWith('ENC[')) {
      return { text: value, end, scrubbed: false };
    }
    return { text: REDACTED_PLACEHOLDER, end, scrubbed: true };
  }
  return { text: '', end: start, scrubbed: false };
}

/** Replaces `LABEL_VALUE_PATTERN`'s old single-regex approach with a
 * manual scan — needed because correctly handling a Python type
 * annotation requires MULTI-STAGE decisions (is there a type here at all?
 * does it have a default value after it? if so, redact THAT, not the
 * type) that one regex alternation can't express. For every
 * `SECRET_FIELD_PATTERN` label found immediately followed by a `:`/`=`
 * separator:
 *  - `label = value` (no type-annotation concept applies at all) or
 *    `label: value` where the value ISN'T a recognized type shape (e.g.
 *    `password: hunter2`) — consume and redact the value exactly as
 *    `LABEL_VALUE_PATTERN` always did.
 *  - `label: Type` (a real, bare type annotation, nothing after it but
 *    `,`/`)`/end) — copied through completely UNTOUCHED. This is the core
 *    A03 fix: a type annotation is never mistaken for a secret value.
 *  - `label: Type = value` (a typed parameter WITH a default) — the type
 *    is copied through untouched, and the ACTUAL default `value` after
 *    `=` is what gets checked/redacted — closing the worse, silent half
 *    of A03 where a REAL secret in this exact shape previously survived
 *    scrubbing completely untouched (the old regex's bare-value match
 *    stopped at the whitespace before `=`, consuming only the type and
 *    leaving the real default value unexamined). */
function scrubLabelValuePairs(text: string): { text: string; scrubbedCount: number } {
  let result = '';
  let scrubbedCount = 0;
  let cursor = 0;
  const labelPattern = new RegExp(SECRET_FIELD_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(text)) !== null) {
    if (match.index < cursor) {
      continue; // already inside a value/type span consumed by an earlier match
    }
    const labelEnd = match.index + match[0].length;
    // A03: the OPTIONAL leading `['"]?` here is what a quoted dict/JSON
    // KEY needs — `{"password": "hunter2"}` has a literal closing quote
    // sitting between the label and the separator that a whitespace-only
    // lookahead would never get past, silently letting a real credential
    // in this extremely common shape through untouched. Harmless for the
    // (far more common) unquoted-key case, where there's simply no quote
    // character there to match.
    const afterLabel = /^['"]?\s*([:=])\s*/.exec(text.slice(labelEnd));
    if (!afterLabel) {
      continue; // not actually a "label SEPARATOR value" shape — e.g. bare prose mention of the word
    }
    const separator = afterLabel[1];
    const cursorAfterSeparator = labelEnd + afterLabel[0].length;

    if (separator === ':') {
      const typeEnd = matchPythonTypeAnnotationEnd(text, cursorAfterSeparator);
      if (typeEnd !== undefined) {
        const afterType = /^\s*=\s*/.exec(text.slice(typeEnd));
        if (!afterType) {
          // A bare type annotation with no default — nothing to redact;
          // copy everything through, including the type, untouched.
          result += text.slice(cursor, typeEnd);
          cursor = typeEnd;
          continue;
        }
        // "label: Type = value" — copy the label/type/"=" through
        // untouched, then redact the DEFAULT value specifically.
        const valueStart = typeEnd + afterType[0].length;
        result += text.slice(cursor, valueStart);
        const consumed = consumeAndRedactValue(text, valueStart);
        result += consumed.text;
        cursor = consumed.end;
        if (consumed.scrubbed) {
          scrubbedCount++;
        }
        continue;
      }
    }

    result += text.slice(cursor, cursorAfterSeparator);
    const consumed = consumeAndRedactValue(text, cursorAfterSeparator);
    result += consumed.text;
    cursor = consumed.end;
    if (consumed.scrubbed) {
      scrubbedCount++;
    }
  }
  result += text.slice(cursor);
  return { text: result, scrubbedCount };
}

export interface ScrubResult {
  text: string;
  /** How many credential-shaped values were found and replaced — surfaced
   * to a caller so it can flag/log the recipe rather than silently save a
   * scrubbed-but-otherwise-unremarked result. */
  scrubbedCount: number;
}

/** Scrubs credential-shaped values out of `text` (a recipe candidate's
 * frontmatter + body, or just its body) — never blocks on an empty/
 * credential-free input, always returns SOMETHING safe to write. A value
 * already replaced by an earlier pass (or an Auto Password Encryption
 * `ENC[...]` token that happened to be present, e.g. copied verbatim from
 * a source file that itself used one) is left untouched — this scrubber
 * only ever REPLACES with a placeholder, it never needs to distinguish
 * "already safe" from "still needs scrubbing" beyond that, since
 * `REDACTED_PLACEHOLDER`/`ENC[` text re-matching either pattern on a
 * second pass would be harmless (would just re-redact an already-redacted
 * value) — but is explicitly guarded against anyway for clarity. */
export function scrubSecretsFromRecipe(text: string): ScrubResult {
  if (!text.trim()) {
    return { text, scrubbedCount: 0 };
  }

  let scrubbedCount = 0;

  const afterConnectionStrings = text.replace(CONNECTION_STRING_CREDENTIAL_PATTERN, (fullMatch, scheme, username, password) => {
    if (!password || password === REDACTED_PLACEHOLDER || password.startsWith('ENC[')) {
      return fullMatch;
    }
    scrubbedCount++;
    return `${scheme}${username}:${REDACTED_PLACEHOLDER}@`;
  });

  // A03 fix: a manual scan (`scrubLabelValuePairs()`) replaces the old
  // single-regex `LABEL_VALUE_PATTERN` approach — see that function's own
  // doc comment for why a Python type annotation needs multi-stage
  // handling ONE regex alternation can't express.
  const { text: afterLabelValues, scrubbedCount: labelValueCount } = scrubLabelValuePairs(afterConnectionStrings);
  scrubbedCount += labelValueCount;

  return { text: afterLabelValues, scrubbedCount };
}
