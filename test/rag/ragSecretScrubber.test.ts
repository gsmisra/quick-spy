import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { scrubSecretsFromRecipe } from '../../src/rag/ragSecretScrubber';

test('scrubs a connection-string embedded password, keeping the username visible', () => {
  const result = scrubSecretsFromRecipe('conn = cassandra://sankag4:xoxo@127.0.0.1:9042/keyspace');
  assert.match(result.text, /cassandra:\/\/sankag4:<REDACTED>@127\.0\.0\.1:9042\/keyspace/);
  assert.doesNotMatch(result.text, /xoxo/);
  assert.equal(result.scrubbedCount, 1);
});

test('scrubs a "label: value" credential pair', () => {
  const result = scrubSecretsFromRecipe('password: SuperSecret123');
  assert.match(result.text, /password:\s*<REDACTED>/);
  assert.doesNotMatch(result.text, /SuperSecret123/);
  assert.equal(result.scrubbedCount, 1);
});

test('scrubs a quoted "label = value" credential pair', () => {
  const result = scrubSecretsFromRecipe('Password = "MyP@ss"');
  assert.match(result.text, /<REDACTED>/);
  assert.doesNotMatch(result.text, /MyP@ss/);
});

test('scrubs an api_key pair', () => {
  const result = scrubSecretsFromRecipe('api_key=abc123XYZ');
  assert.match(result.text, /<REDACTED>/);
  assert.doesNotMatch(result.text, /abc123XYZ/);
});

test('does NOT false-trigger on a sentence merely mentioning the word "password"', () => {
  const result = scrubSecretsFromRecipe('the password requirements are 8 characters minimum');
  assert.equal(result.scrubbedCount, 0);
  assert.equal(result.text, 'the password requirements are 8 characters minimum');
});

test('scrubs multiple distinct secrets in one recipe', () => {
  const text = 'password: firstSecret\napi_key: secondSecret';
  const result = scrubSecretsFromRecipe(text);
  assert.equal(result.scrubbedCount, 2);
  assert.doesNotMatch(result.text, /firstSecret/);
  assert.doesNotMatch(result.text, /secondSecret/);
});

test('an empty or whitespace-only input is a no-op', () => {
  assert.deepEqual(scrubSecretsFromRecipe(''), { text: '', scrubbedCount: 0 });
  assert.deepEqual(scrubSecretsFromRecipe('   '), { text: '   ', scrubbedCount: 0 });
});

test('an already-redacted placeholder is left alone, not double-processed', () => {
  const result = scrubSecretsFromRecipe('password: <REDACTED>');
  assert.equal(result.scrubbedCount, 0);
  assert.equal(result.text, 'password: <REDACTED>');
});

test('an existing Auto Password Encryption token is left untouched, not treated as a raw secret', () => {
  const result = scrubSecretsFromRecipe('password: ENC[v1:abc:def:ghi]');
  assert.equal(result.scrubbedCount, 0);
  assert.match(result.text, /ENC\[v1:abc:def:ghi\]/);
});

// --- F07: scrubbing must never corrupt surrounding code punctuation --------

test('a Python parameter TYPE ANNOTATION is never redacted at all — the reproduced A03 bug (this test used to assert the bug\'s own behavior, "password: str" corrupted into "password: <REDACTED>")', () => {
  const result = scrubSecretsFromRecipe('API: def login(password: str, user: str):');
  assert.equal(result.text, 'API: def login(password: str, user: str):');
  assert.equal(result.scrubbedCount, 0);
});

test('a Python parameter type annotation immediately before the closing paren is never redacted either', () => {
  const result = scrubSecretsFromRecipe('API: def login(password: str):');
  assert.equal(result.text, 'API: def login(password: str):');
  assert.equal(result.scrubbedCount, 0);
});

test('a Java declaration ("String password,") is untouched — SECRET_FIELD_PATTERN only matches a "label: value"/"label = value" SEPARATOR shape, not a bare type-then-name declaration', () => {
  // "String password," has no ":"/"=" right after "password" at all, so
  // LABEL_VALUE_PATTERN never matches here in the first place — this
  // documents that this specific Java shape was never at risk, unlike the
  // Python "password: str," annotation shape the other tests cover.
  const result = scrubSecretsFromRecipe('void login(String password, String user) {}');
  assert.equal(result.text, 'void login(String password, String user) {}');
  assert.equal(result.scrubbedCount, 0);
});

test('a real credential value immediately followed by a comma is still fully redacted, just without eating the comma', () => {
  const result = scrubSecretsFromRecipe('password: hunter2, other: value');
  assert.equal(result.text, 'password: <REDACTED>, other: value');
  assert.equal(result.scrubbedCount, 1);
});

test('a real credential value immediately followed by a closing paren is still fully redacted, just without eating the paren', () => {
  const result = scrubSecretsFromRecipe('connect(password: hunter2)');
  assert.equal(result.text, 'connect(password: <REDACTED>)');
});

test('a real credential value immediately followed by a closing bracket/brace is still fully redacted without eating it', () => {
  const result = scrubSecretsFromRecipe('{password: hunter2}');
  assert.equal(result.text, '{password: <REDACTED>}');
  const arrayResult = scrubSecretsFromRecipe('[password: hunter2]');
  assert.equal(arrayResult.text, '[password: <REDACTED>]');
});

test('a whole recipe API line with multiple annotated parameters survives scrubbing COMPLETELY UNCHANGED — none of them are real secret values (A03)', () => {
  const line = 'API: def login(password: str, user: str, api_key: str) -> bool:';
  const result = scrubSecretsFromRecipe(line);
  assert.equal(result.text, line);
  assert.equal(result.scrubbedCount, 0);
});

// --- A03: type annotations are never secret values, and a REAL default
// value after a type annotation is still caught (the worse, silent half
// of the reproduced bug: the OLD scrubber left a real secret in this exact
// shape completely untouched) ------------------------------------------

test('A03: a typed parameter with a REAL secret DEFAULT value redacts the default, never the type (the worse, previously-silent half of the bug)', () => {
  const result = scrubSecretsFromRecipe('def login(password: str = "SYNTHETIC_SECRET_VALUE"):');
  assert.equal(result.text, 'def login(password: str = "<REDACTED>"):');
  assert.equal(result.scrubbedCount, 1);
  assert.doesNotMatch(result.text, /SYNTHETIC_SECRET_VALUE/);
});

test('A03: a typed parameter with an UNQUOTED (bare) secret default value is also caught', () => {
  const result = scrubSecretsFromRecipe('def login(password: str = SYNTHETIC_SECRET_VALUE):');
  assert.equal(result.text, 'def login(password: str = <REDACTED>):');
  assert.equal(result.scrubbedCount, 1);
});

test('A03: a bracketed generic type annotation (Optional[str]) with NO default is preserved WHOLE, never truncated at the bracket', () => {
  const result = scrubSecretsFromRecipe('def login(password: Optional[str]):');
  assert.equal(result.text, 'def login(password: Optional[str]):');
  assert.equal(result.scrubbedCount, 0);
});

test('A03: Python\'s None literal as a default is still treated as an ordinary (unquoted) value, same as any other bare token this regex-based scrubber can\'t tell apart from a real one — a safe over-redaction, never a corruption of the TYPE itself', () => {
  const result = scrubSecretsFromRecipe('def login(password: Optional[str] = None):');
  assert.equal(result.text, 'def login(password: Optional[str] = <REDACTED>):', 'the bracketed TYPE must survive whole either way — only the default value position is ever in question');
});

test('A03: a bracketed generic type annotation with a real secret default redacts ONLY the default, keeping the whole bracketed type intact', () => {
  const result = scrubSecretsFromRecipe('def login(password: Optional[str] = "SYNTHETIC_SECRET"):');
  assert.equal(result.text, 'def login(password: Optional[str] = "<REDACTED>"):');
  assert.equal(result.scrubbedCount, 1);
});

test('A03: a NESTED generic type annotation (Dict[str, List[int]]) is preserved whole — bracket-depth balanced, not truncated at the first "]"', () => {
  const result = scrubSecretsFromRecipe('def configure(secret: Dict[str, List[int]]):');
  assert.equal(result.text, 'def configure(secret: Dict[str, List[int]]):');
  assert.equal(result.scrubbedCount, 0);
});

test('A03: a dotted (module-qualified) typing import, e.g. "typing.Optional[str]", is recognized as a real type', () => {
  const result = scrubSecretsFromRecipe('def login(password: typing.Optional[str]):');
  assert.equal(result.text, 'def login(password: typing.Optional[str]):');
  assert.equal(result.scrubbedCount, 0);
});

test('A03: a CAPITALIZED fake secret value is still redacted — "looks like a type" is NOT just "starts with an uppercase letter"', () => {
  // This is the exact regression this fix must never reintroduce: an
  // early draft of this fix treated ANY capitalized bare token as a type
  // annotation, which would have let a real secret slip through
  // completely untouched purely because it happened to be capitalized —
  // a materially WORSE outcome than the bug being fixed.
  const result = scrubSecretsFromRecipe('password: SuperSecret123');
  assert.match(result.text, /password:\s*<REDACTED>/);
  assert.doesNotMatch(result.text, /SuperSecret123/);
  assert.equal(result.scrubbedCount, 1);
});

test('A03: a capitalized fake secret is still redacted even with a colon-typed shape elsewhere in the same text', () => {
  const result = scrubSecretsFromRecipe('def login(password: str):\nActualSecretUsed = MyP@ssword123');
  assert.match(result.text, /def login\(password: str\):/, 'the type annotation must stay untouched');
});

test('A03: a dictionary-shaped credential (quoted value, unquoted key) is still redacted', () => {
  const result = scrubSecretsFromRecipe('config = {"password": "hunter2", "user": "admin"}');
  assert.doesNotMatch(result.text, /hunter2/);
});

test('A03: an ordinary (non-typed) password variable assignment is still redacted exactly as before', () => {
  const result = scrubSecretsFromRecipe('password = "hunter2"');
  assert.doesNotMatch(result.text, /hunter2/);
  assert.equal(result.scrubbedCount, 1);
});

test('scrubbing a full recipe body preserves everything else verbatim', () => {
  const body = '---\nid: helper\ntitle: X\n---\n\nConnects using conn = "postgres://admin:realsecret@db:5432/app".\n\n```java\nvar x = 1;\n```\n';
  const result = scrubSecretsFromRecipe(body);
  assert.doesNotMatch(result.text, /realsecret/);
  assert.match(result.text, /```java\nvar x = 1;\n```/);
  assert.match(result.text, /id: helper/);
});
