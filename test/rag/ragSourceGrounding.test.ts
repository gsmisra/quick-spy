import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateSourceGrounding, normalizeJavaImportPath } from '../../src/rag/ragSourceGrounding';
import type { ExtractedCapability } from '../../src/rag/ragCapabilityExtraction';

function makeCapability(overrides: Partial<ExtractedCapability> = {}): ExtractedCapability {
  return {
    name: 'queryOne',
    kind: 'method',
    ownerClassName: 'PostgresHelper',
    signature: 'public List<Row> queryOne(String sql, Object... params)',
    excerpt: 'public List<Row> queryOne(String sql, Object... params) { return null; }',
    ...overrides
  };
}

test('passes when the capability name appears, fences are complete, and no java package check applies', () => {
  const result = validateSourceGrounding(
    'API: queryOne(sql, params)\n```java\nvar rows = PostgresHelper.queryOne(sql, params);\n```',
    undefined,
    makeCapability(),
    undefined
  );
  assert.equal(result.ok, true);
});

test('rejects when the capability name never appears (as an actual call) in the body — the model drifted onto something else', () => {
  const result = validateSourceGrounding('API: doSomethingElse()\n```java\ndoSomethingElse();\n```', undefined, makeCapability(), undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /never shows an actual CALL to "queryOne\(/);
});

test('rejects an unclosed fenced code block', () => {
  const result = validateSourceGrounding('API: PostgresHelper.queryOne(...)\n```java\nvar rows = PostgresHelper.queryOne();\n', undefined, makeCapability(), undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /unclosed fenced code block/);
});

test('accepts a body with multiple COMPLETE fences', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne example one:\n```java\nPostgresHelper.queryOne(sql);\n```\nPostgresHelper.queryOne example two:\n```java\nPostgresHelper.queryOne(sql);\n```',
    undefined,
    makeCapability(),
    undefined
  );
  assert.equal(result.ok, true);
});

test('accepts when a declared Java import matches the real package', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne(sql);\n```',
    ['com.acme.testutil.db.PostgresHelper'],
    makeCapability(),
    'com.acme.testutil.db'
  );
  assert.equal(result.ok, true);
});

test('rejects when NO declared Java import matches the real package', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne();\n```',
    ['com.totally.different.package.SomeOtherHelper'],
    makeCapability(),
    'com.acme.testutil.db'
  );
  assert.equal(result.ok, false);
  assert.match(result.reason!, /None of the declared Java import\(s\)/);
  assert.match(result.reason!, /source file's own package/);
});

test('does not check java package consistency when no imports are declared at all', () => {
  const result = validateSourceGrounding('PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne(sql);\n```', undefined, makeCapability(), 'com.acme.testutil.db');
  assert.equal(result.ok, true);
});

test('does not check java package consistency when the package itself is unknown (undefined)', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne(sql);\n```',
    ['com.whatever.Anything'],
    makeCapability(),
    undefined
  );
  assert.equal(result.ok, true);
});

test('a mix of standard-library AND real-package imports still passes as long as one matches', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne(sql);\n```',
    ['java.util.List', 'com.acme.testutil.db.PostgresHelper'],
    makeCapability(),
    'com.acme.testutil.db'
  );
  assert.equal(result.ok, true);
});

// --- F05: a conventional "import x.y.Z;" statement is no longer wrongly rejected ---

test('normalizeJavaImportPath strips a full "import x.y.Z;" statement down to the bare path', () => {
  assert.equal(normalizeJavaImportPath('import com.acme.db.PostgresHelper;'), 'com.acme.db.PostgresHelper');
});

test('normalizeJavaImportPath strips a "static import" statement too', () => {
  assert.equal(normalizeJavaImportPath('import static com.acme.db.PostgresHelper.queryOne;'), 'com.acme.db.PostgresHelper.queryOne');
});

test('normalizeJavaImportPath leaves an already-bare path completely unchanged', () => {
  assert.equal(normalizeJavaImportPath('com.acme.db.PostgresHelper'), 'com.acme.db.PostgresHelper');
});

test('normalizeJavaImportPath trims incidental surrounding whitespace', () => {
  assert.equal(normalizeJavaImportPath('  import com.acme.db.PostgresHelper;  '), 'com.acme.db.PostgresHelper');
});

test('validateSourceGrounding accepts a conventional full "import x.y.Z;" statement matching the real package (the reproduced F05 bug)', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne(sql);\n```',
    ['import com.acme.testutil.db.PostgresHelper;'],
    makeCapability(),
    'com.acme.testutil.db'
  );
  assert.equal(result.ok, true);
});

// --- F04: a bare mention of the name is no longer enough; the real owner must appear too ---

test('rejects a fabricated invocation on an entirely different, invented receiver (the reproduced F04 bug)', () => {
  const result = validateSourceGrounding('API: public void find()\n```java\nFake.find();\n```', ['acme.DoesNotExist'], makeCapability({ name: 'find', ownerClassName: 'Finder' }), undefined);
  assert.equal(result.ok, false);
  // A02: now a receiver-consistency rejection (the example's OWN call site
  // names a receiver unrelated to the real owner), a strictly more
  // precise diagnosis than the old "never mentions X anywhere" check this
  // message replaced.
  assert.match(result.reason!, /receiver that matches neither the real owner class "Finder"/);
});

test('rejects prose that merely mentions the capability name without ever actually calling it (the reproduced F04 bug)', () => {
  const result = validateSourceGrounding('This find helper is unavailable.', undefined, makeCapability({ name: 'find', ownerClassName: 'Finder' }), undefined);
  assert.equal(result.ok, false);
  // A02: a body with no fenced example at all is now rejected at that
  // earlier, more specific check — "no fenced code example," not "no
  // call shape" (there is no example to even look for a call inside).
  assert.match(result.reason!, /no fenced code example at all/);
});

test('accepts a real invocation that correctly names both the capability AND its real owner', () => {
  const result = validateSourceGrounding('```java\nvar row = Finder.find(42);\n```', undefined, makeCapability({ name: 'find', ownerClassName: 'Finder' }), undefined);
  assert.equal(result.ok, true);
});

test('does not require an owner mention when the capability has no owner (a top-level function/whole-file capability)', () => {
  const result = validateSourceGrounding('```java\nstandaloneHelper(42);\n```', undefined, makeCapability({ name: 'standaloneHelper', ownerClassName: undefined }), undefined);
  assert.equal(result.ok, true);
});

test('a name appearing only as a longer identifier (e.g. "findAll") does not satisfy the call-shape check for "find"', () => {
  const result = validateSourceGrounding('```java\nvar all = Finder.findAll();\n```', undefined, makeCapability({ name: 'find', ownerClassName: 'Finder' }), undefined);
  assert.equal(result.ok, false);
});

test('a static-style call shape (bare "name(" with no receiver) still counts as a real call', () => {
  const result = validateSourceGrounding('```java\nvar row = find(42);\n```\nUses Finder internally.', undefined, makeCapability({ name: 'find', ownerClassName: 'Finder' }), undefined);
  assert.equal(result.ok, true);
});

test('validateSourceGrounding still rejects a full import statement for a genuinely DIFFERENT, unrelated package', () => {
  const result = validateSourceGrounding(
    'PostgresHelper.queryOne\n```java\nPostgresHelper.queryOne();\n```',
    ['import acme.DoesNotExist;'],
    makeCapability(),
    'com.acme.testutil.db'
  );
  assert.equal(result.ok, false);
});

// --- F04 (second half): argument-COUNT verification -------------------------

test('rejects a call to the right owner/name with an implausible argument count (the exact review-reported bug: find(int id) called as find(name, extra))', () => {
  const capability = makeCapability({
    name: 'find',
    ownerClassName: 'Finder',
    signature: 'public Row find(int id)',
    excerpt: 'public Row find(int id) { return byId(id); }'
  });
  const result = validateSourceGrounding('```java\nvar row = Finder.find(name, extra);\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /expects exactly 1 argument\(s\)/);
  assert.match(result.reason!, /observed: 2/);
});

test('accepts a call to a single-parameter capability passing exactly one argument', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nvar row = Finder.find(42);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('rejects a zero-argument call to a capability that actually requires an argument', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nvar row = Finder.find();\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /observed: 0/);
});

test('a genuinely zero-parameter capability requires an exact zero-argument call', () => {
  const capability = makeCapability({ name: 'close', ownerClassName: 'Connection', signature: 'public void close()', excerpt: 'public void close() { conn.close(); }' });
  assert.equal(validateSourceGrounding('```java\nConnection.close();\n```', undefined, capability, undefined).ok, true);
  const wrong = validateSourceGrounding('```java\nConnection.close(force);\n```', undefined, capability, undefined);
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason!, /expects exactly 0 argument\(s\)/);
});

test('a Java varargs parameter accepts any number of trailing arguments (zero or more), never just the fixed count', () => {
  const capability = makeCapability(); // signature: queryOne(String sql, Object... params)
  assert.equal(validateSourceGrounding('```java\nPostgresHelper.queryOne(sql);\n```', undefined, capability, undefined).ok, true, 'varargs slot may be empty');
  assert.equal(validateSourceGrounding('```java\nPostgresHelper.queryOne(sql, a, b, c);\n```', undefined, capability, undefined).ok, true, 'varargs slot may take several');
  const missingFixed = validateSourceGrounding('```java\nPostgresHelper.queryOne();\n```', undefined, capability, undefined);
  assert.equal(missingFixed.ok, false, 'the one FIXED (non-varargs) parameter is still required');
});

test('a nested call/generic-diamond inside one argument is never miscounted as multiple arguments (nested-comma defeat case)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(Map<String, Object> filters)', excerpt: 'public Row find(Map<String, Object> filters) { return null; }' });
  const result = validateSourceGrounding('```java\nvar row = Finder.find(new HashMap<String, Object>());\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('a string-literal argument containing a comma is never miscounted as two arguments', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(String csv)', excerpt: 'public Row find(String csv) { return null; }' });
  const result = validateSourceGrounding('```java\nvar row = Finder.find("a, b, c");\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('a Python bound-method call never has to (and must not be required to) pass "self" explicitly', () => {
  const capability = makeCapability({ name: 'query_one', ownerClassName: 'PostgresHelper', signature: 'def query_one(self, sql):', excerpt: 'def query_one(self, sql):\n    return self.execute(sql)' });
  const result = validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql)\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('a Python parameter with a default value is OPTIONAL — a call omitting it is still valid', () => {
  const capability = makeCapability({
    name: 'query_one',
    ownerClassName: 'PostgresHelper',
    signature: 'def query_one(self, sql, timeout=30):',
    excerpt: 'def query_one(self, sql, timeout=30):\n    return self.execute(sql, timeout)'
  });
  assert.equal(
    validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql)\n```', undefined, capability, undefined).ok,
    true,
    'omitting the defaulted param is valid'
  );
  assert.equal(
    validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql, 60)\n```', undefined, capability, undefined).ok,
    true,
    'supplying it is also valid'
  );
});

test('a Python **kwargs parameter makes the max unbounded — extra keyword arguments never trigger a false rejection', () => {
  const capability = makeCapability({
    name: 'query_one',
    ownerClassName: 'PostgresHelper',
    signature: 'def query_one(self, sql, **options):',
    excerpt: 'def query_one(self, sql, **options):\n    return self.execute(sql, **options)'
  });
  const result = validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql, retries=3, timeout=10)\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('a Python call passing too FEW required (non-defaulted) arguments is still rejected', () => {
  const capability = makeCapability({ name: 'query_one', ownerClassName: 'PostgresHelper', signature: 'def query_one(self, sql, params):', excerpt: 'def query_one(self, sql, params):\n    return self.execute(sql, params)' });
  const result = validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql)\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /observed: 1/);
});

test('an "async def" capability (F03) is still recognized as Python for argument-count verification, not silently skipped', () => {
  const capability = makeCapability({
    name: 'fetch_row',
    ownerClassName: 'Client',
    signature: 'async def fetch_row(self, sql):',
    excerpt: 'async def fetch_row(self, sql):\n    return await self.execute(sql)'
  });
  const okResult = validateSourceGrounding('```python\nclient = Client()\nrow = await client.fetch_row(sql)\n```', undefined, capability, undefined);
  assert.equal(okResult.ok, true);
  const wrongCountResult = validateSourceGrounding('```python\nclient = Client()\nrow = await client.fetch_row()\n```', undefined, capability, undefined);
  assert.equal(wrongCountResult.ok, false);
  assert.match(wrongCountResult.reason!, /observed: 0/);
});

test('fails OPEN (never rejects) when every call-shaped occurrence is unparseable (e.g. an unclosed call left dangling by other malformed content)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  // The FENCE itself is complete (A02 now requires a real fenced example
  // to exist at all) — it's the CODE inside it that's unparseable:
  // "Finder.find(" never closes with a matching ")" anywhere, so
  // findMatchingParen returns undefined and there is nothing to verify
  // the argument count against. This must never be treated as "verified
  // wrong" — a separate, unclosed-FENCE check (a different, already-
  // covered failure mode) is what catches a genuinely truncated fence.
  const result = validateSourceGrounding('```java\nFinder.find(\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

// --- A02: a real fenced example is REQUIRED, and its own call site (not
// disconnected prose) must be consistent with the real owner -----------

test('A02: rejects a body with NO fenced code example at all, even with a correct API declaration and an owner label (the exact reproduced bug)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Helper', signature: 'public int find(int id)', excerpt: 'public int find(int id) { return id; }' });
  const result = validateSourceGrounding('API: public int find(int id)\nOwner: Helper', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /no fenced code example at all/);
});

test('A02: rejects a body whose only fence is blank — a description alone is still not an example', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Helper', signature: 'public int find(int id)', excerpt: 'public int find(int id) { return id; }' });
  const result = validateSourceGrounding('```java\n\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /no fenced code example at all/);
});

test('A02: rejects a fenced example calling a FABRICATED receiver while the real owner is only mentioned in disconnected prose (the exact reproduced bug)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Helper', signature: 'public int find(int id)', excerpt: 'public int find(int id) { return id; }' });
  const result = validateSourceGrounding('API: public int find(int id)\nOwner: Helper\n```java\nFake.find(1);\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /receiver that matches neither the real owner class "Helper"/);
});

test('A02: the API declaration line itself is never mistaken for a real invocation, even when it sits right next to a valid fenced example', () => {
  // Without A02's fix, "public int find(int id)" in the prose ALONE
  // would already satisfy the old whole-body call-shape scan (a return
  // type followed by a space and "find(" is textually identical to a
  // real call) — this confirms the check now genuinely requires the
  // FENCED example itself to contain the call, which it does here too.
  const capability = makeCapability({ name: 'find', ownerClassName: 'Helper', signature: 'public int find(int id)', excerpt: 'public int find(int id) { return id; }' });
  const result = validateSourceGrounding('API: public int find(int id)\n```java\nhelper.find(1);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('A02: accepts a receiver bound to the real owner via a Python constructor assignment earlier in the SAME example (the common, legitimate instance-variable pattern)', () => {
  const capability = makeCapability({ name: 'query_one', ownerClassName: 'PostgresHelper', signature: 'def query_one(self, sql):', excerpt: 'def query_one(self, sql):\n    return self.execute(sql)' });
  const result = validateSourceGrounding('```python\nhelper = PostgresHelper()\nrow = helper.query_one(sql)\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('A02: accepts a receiver bound to the real owner via a Java declared-type local variable (not just the class name reused as the variable name)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nFinder finder = new Finder();\nvar row = finder.find(1);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('A02: a generic instance-variable receiver with NO local binding evidence at all is still rejected (the binding check does not just wave through any lowercase name)', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nvar row = somethingUnrelated.find(1);\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /receiver that matches neither the real owner class "Finder"/);
});

test('A02: a constructor capability is validated correctly (no receiver at all — "new Finder(...)" — falls back to the whole-body mention check, which the call itself satisfies)', () => {
  const capability = makeCapability({ name: 'Finder', kind: 'constructor', ownerClassName: 'Finder', signature: 'public Finder(int id)', excerpt: 'public Finder(int id) { this.id = id; }' });
  const result = validateSourceGrounding('```java\nvar finder = new Finder(1);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('A02: a Python static-style call (via the class name directly) is accepted', () => {
  const capability = makeCapability({
    name: 'build_dsn',
    ownerClassName: 'PostgresHelper',
    signature: 'def build_dsn(host, port):',
    excerpt: 'def build_dsn(host, port):\n    return f"host={host} port={port}"'
  });
  const result = validateSourceGrounding('```python\nPostgresHelper.build_dsn("localhost", 5432)\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});

test('A02: with MULTIPLE examples, at least one genuinely correct call is enough to pass, even if another example calls a fabricated receiver', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nFinder.find(1);\n```\nA second, malformed illustration:\n```java\nFake.find(2);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true, 'one genuinely correct example is enough, even alongside a second, bad one');
});

test('A02: with MULTIPLE examples, if EVERY one calls a fabricated receiver, the recipe is rejected', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'public Row find(int id)', excerpt: 'public Row find(int id) { return byId(id); }' });
  const result = validateSourceGrounding('```java\nFake.find(1);\n```\nAnother:\n```java\nAlsoFake.find(2);\n```', undefined, capability, undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /receiver that matches neither the real owner class "Finder"/);
});

test('fails OPEN (never rejects) when the signature shape is not a recognizable Java/Python declaration', () => {
  const capability = makeCapability({ name: 'find', ownerClassName: 'Finder', signature: 'find', excerpt: 'find' });
  const result = validateSourceGrounding('```java\nFinder.find(anything, at, all);\n```', undefined, capability, undefined);
  assert.equal(result.ok, true);
});
