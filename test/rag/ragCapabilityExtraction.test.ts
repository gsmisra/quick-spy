import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractCapabilities, capabilitiesForFile, countDeferredCapabilities, extractAllCallableUnitsForDependencyDiscovery, MAX_CAPABILITIES_PER_FILE } from '../../src/rag/ragCapabilityExtraction';

const JAVA_HELPER = `package com.acme.testutil.db;

import java.sql.Connection;

public class PostgresHelper {
  private final Connection conn;

  public PostgresHelper(Connection conn) {
    this.conn = conn;
  }

  public List<Row> queryOne(String sql, Object... params) {
    // does the actual query work here
    return runQuery(sql, params);
  }

  private List<Row> runQuery(String sql, Object[] params) {
    return null;
  }

  public void close() throws SQLException {
    conn.close();
  }
}
`;

test('extracts every PUBLIC method from a Java class, skipping private ones', () => {
  const caps = extractCapabilities('PostgresHelper.java', JAVA_HELPER);
  const names = caps.map((c) => c.name);
  assert.ok(names.includes('queryOne'));
  assert.ok(names.includes('close'));
  assert.ok(!names.includes('runQuery'), 'private methods must never be extracted as callable capabilities');
});

test('extracts the public constructor, tagged with kind "constructor"', () => {
  const caps = extractCapabilities('PostgresHelper.java', JAVA_HELPER);
  const ctor = caps.find((c) => c.kind === 'constructor');
  assert.ok(ctor);
  assert.equal(ctor!.name, 'PostgresHelper');
  assert.equal(ctor!.ownerClassName, 'PostgresHelper');
});

test('every extracted Java capability carries the correct owner class name', () => {
  const caps = extractCapabilities('PostgresHelper.java', JAVA_HELPER);
  assert.ok(caps.every((c) => c.ownerClassName === 'PostgresHelper'));
});

test('a Java capability\'s excerpt is a verbatim slice including its own signature and full body', () => {
  const caps = extractCapabilities('PostgresHelper.java', JAVA_HELPER);
  const queryOne = caps.find((c) => c.name === 'queryOne')!;
  assert.match(queryOne.excerpt, /public List<Row> queryOne/);
  assert.match(queryOne.excerpt, /return runQuery\(sql, params\);/);
  assert.ok(queryOne.excerpt.trimEnd().endsWith('}'), 'excerpt should end with its own closing brace, nothing more');
  assert.doesNotMatch(queryOne.excerpt, /public void close/, 'must not spill into the next method');
});

test('a string literal containing braces does not confuse the Java body-extent scanner', () => {
  const javaWithBracesInString = `public class Formatter {
  public String wrap(String s) {
    return "{" + s + "}";
  }
}
`;
  const caps = extractCapabilities('Formatter.java', javaWithBracesInString);
  const wrap = caps.find((c) => c.name === 'wrap');
  assert.ok(wrap, 'the method must still be found despite braces inside its own string literal');
  assert.match(wrap!.excerpt, /return "\{" \+ s \+ "\}";/);
});

test('a Java file with no class at all extracts zero capabilities (falls back to whole-file treatment)', () => {
  assert.deepEqual(extractCapabilities('Interfaceish.java', 'public interface Marker {}\n'), []);
});

test('a Java file with no PUBLIC methods extracts zero capabilities', () => {
  const allPrivate = `public class Internal {
  private void helper() {}
}
`;
  assert.deepEqual(extractCapabilities('Internal.java', allPrivate), []);
});

test('extraction is capped at a maximum number of capabilities per file', () => {
  const methodCount = MAX_CAPABILITIES_PER_FILE + 10;
  const manyMethods = Array.from({ length: methodCount }, (_, i) => `  public void method${i}() {}`).join('\n');
  const bigClass = `public class Big {\n${manyMethods}\n}\n`;
  const caps = extractCapabilities('Big.java', bigClass);
  assert.ok(caps.length <= MAX_CAPABILITIES_PER_FILE);
});

// --- F03: the cap's own cutoff is now traceable, not silent -----------------

test('countDeferredCapabilities reports exactly how many methods were left out by the cap', () => {
  const methodCount = MAX_CAPABILITIES_PER_FILE + 10;
  const manyMethods = Array.from({ length: methodCount }, (_, i) => `  public void method${i}() {}`).join('\n');
  const bigClass = `public class Big {\n${manyMethods}\n}\n`;
  assert.equal(countDeferredCapabilities('Big.java', bigClass), methodCount - MAX_CAPABILITIES_PER_FILE);
});

test('countDeferredCapabilities is 0 when everything found fits within the cap', () => {
  const smallClass = 'public class Small {\n  public void one() {}\n  public void two() {}\n}\n';
  assert.equal(countDeferredCapabilities('Small.java', smallClass), 0);
});

test('countDeferredCapabilities is 0 for a file with no extractable capabilities at all', () => {
  assert.equal(countDeferredCapabilities('Config.properties', 'key=value'), 0);
});

// --- F03: a method signature inside a Javadoc block comment is NOT extracted as callable ---

test('a Java method-shaped signature inside a /** ... */ block comment is never extracted as a real callable (the reproduced bug)', () => {
  const withCommentedExample = `public class Real {
  /**
   * Example usage:
   * public void fakeMethodInComment() {
   *   doSomethingFake();
   * }
   */
  public void realMethod() {
    doSomethingReal();
  }
}
`;
  const caps = extractCapabilities('Real.java', withCommentedExample);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].name, 'realMethod');
  assert.ok(!caps.some((c) => c.name === 'fakeMethodInComment'));
});

test('a method inside a block comment BEFORE a real class declaration does not corrupt real extraction', () => {
  const withLeadingCommentedExample = `/**
 * public class FakeExampleClass {
 *   public void fake() {}
 * }
 */
public class RealClass {
  public void real() {
    doWork();
  }
}
`;
  const caps = extractCapabilities('RealClass.java', withLeadingCommentedExample);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].name, 'real');
  assert.equal(caps[0].ownerClassName, 'RealClass');
});

test('block-comment masking never affects the ACTUAL excerpt text of a real method (still a verbatim, unmangled slice)', () => {
  const content = `public class Real {
  /** Some doc comment. */
  public void realMethod() {
    doSomethingReal();
  }
}
`;
  const caps = extractCapabilities('Real.java', content);
  assert.equal(caps.length, 1);
  assert.match(caps[0].excerpt, /doSomethingReal\(\);/);
  assert.doesNotMatch(caps[0].excerpt, /^\s*$/); // never blanked out
});

test('a real method whose body contains its own block comment is still extracted correctly (masking only affects MATCHING, never the excerpt)', () => {
  const content = `public class Real {
  public void realMethod() {
    /* a comment inside the real method body */
    doSomethingReal();
  }
}
`;
  const caps = extractCapabilities('Real.java', content);
  assert.equal(caps.length, 1);
  assert.match(caps[0].excerpt, /a comment inside the real method body/);
  assert.match(caps[0].excerpt, /doSomethingReal\(\);/);
});

test('a line-comment (//) containing method-shaped text is never extracted (already-correct behavior, unaffected by the block-comment fix)', () => {
  const content = `public class Real {
  // public void fakeCommentedMethod() {}
  public void real() {
    doWork();
  }
}
`;
  const caps = extractCapabilities('Real.java', content);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].name, 'real');
});

// --- F02: overloaded methods get distinct naming ids -------------------------

test('overloaded Java methods (same name, same owner class) each get a DISTINCT namingId — the bug this fixes', () => {
  const overloaded = `public class Finder {
  public Row find(int id) {
    return byId(id);
  }

  public Row find(String name) {
    return byName(name);
  }
}
`;
  const caps = extractCapabilities('Finder.java', overloaded);
  assert.equal(caps.length, 2);
  assert.ok(caps.every((c) => c.name === 'find'), 'the real callable name must stay "find" for both — unaffected by naming disambiguation');
  assert.ok(caps[0].namingId, 'a colliding capability must get a namingId');
  assert.ok(caps[1].namingId, 'a colliding capability must get a namingId');
  assert.notEqual(caps[0].namingId, caps[1].namingId);
});

test('overload namingId disambiguation is deterministic — re-extracting the same file gives the same namingIds', () => {
  const overloaded = `public class Finder {
  public Row find(int id) {
    return byId(id);
  }

  public Row find(String name) {
    return byName(name);
  }
}
`;
  const first = extractCapabilities('Finder.java', overloaded);
  const second = extractCapabilities('Finder.java', overloaded);
  assert.deepEqual(
    first.map((c) => c.namingId),
    second.map((c) => c.namingId)
  );
});

test('a non-overloaded method name gets NO namingId at all — untouched, backward compatible', () => {
  const notOverloaded = `public class Finder {
  public Row find(int id) {
    return byId(id);
  }

  public void close() {
  }
}
`;
  const caps = extractCapabilities('Finder.java', notOverloaded);
  assert.ok(caps.every((c) => c.namingId === undefined));
});

test('two methods with the SAME name but DIFFERENT owner classes are not treated as overloads of each other', () => {
  // F03 fix: extraction now finds EVERY class in a file (nested or
  // sibling), not just one — this exercises the real multi-class case
  // directly, rather than the pre-F03 single-class placeholder this test
  // used to be.
  const twoClasses = `public class Outer {
  public static class Inner {
    public Row find(int id) {
      return Inner.byId(id);
    }
  }
}

class Sibling {
  public Row find(int id) {
    return Sibling.byId(id);
  }
}
`;
  const caps = extractCapabilities('Outer.java', twoClasses);
  const finds = caps.filter((c) => c.name === 'find');
  assert.equal(finds.length, 2);
  assert.notEqual(finds[0].ownerClassName, finds[1].ownerClassName, 'same-named methods on DIFFERENT classes are different capabilities, not overloads');
  // A05 fix: these are NOT real overloads (different owners, not the same
  // one), so they're never disambiguated by a SIGNATURE hash the way a
  // real overload is — but they DO still need a namingId, since
  // capabilityNameForNaming() (ragCorpusGenerator.ts) would otherwise fold
  // BOTH down to the identical bare "find" for target-path/sourcePath
  // purposes, causing a spurious content CONFLICT between two entirely
  // valid, different capabilities. Disambiguated by the OWNER's own name
  // instead — see disambiguateCapabilityNames()'s own doc comment.
  assert.ok(
    finds.every((c) => c.namingId !== undefined),
    'same bare name across DIFFERENT owners in one file must still get a namingId, or their target paths/sourcePaths collide (the A05 bug)'
  );
  assert.equal(finds[0].namingId, `${finds[0].ownerClassName}-find`);
  assert.equal(finds[1].namingId, `${finds[1].ownerClassName}-find`);
  assert.notEqual(finds[0].namingId, finds[1].namingId);
});

// --- F03: nested/multiple Java classes get the RIGHT owner ------------------

test('a method inside a NESTED (inner) class is attributed to the INNER class, never the outer one (the reproduced F03 bug)', () => {
  const withNestedClass = `public class Outer {
  public void outerMethod() {
    doOuterWork();
  }

  public static class Inner {
    public void innerMethod() {
      doInnerWork();
    }
  }
}
`;
  const caps = extractCapabilities('Outer.java', withNestedClass);
  const outerMethod = caps.find((c) => c.name === 'outerMethod')!;
  const innerMethod = caps.find((c) => c.name === 'innerMethod')!;
  assert.ok(outerMethod, 'outerMethod must still be extracted');
  assert.ok(innerMethod, 'innerMethod must still be extracted');
  assert.equal(outerMethod.ownerClassName, 'Outer');
  assert.equal(innerMethod.ownerClassName, 'Inner', 'the OLD single-file-wide owner guess would have wrongly said "Outer" here');
});

test('a NESTED class\'s own constructor is extracted with the nested class as its owner (previously silently skipped)', () => {
  const withNestedConstructor = `public class Outer {
  public static class Inner {
    public Inner(int id) {
      this.id = id;
    }
  }
}
`;
  const caps = extractCapabilities('Outer.java', withNestedConstructor);
  const ctor = caps.find((c) => c.kind === 'constructor');
  assert.ok(ctor, 'the nested class\'s own constructor must be extracted — the OLD code only ever matched a constructor against the FILE-WIDE (outer) class name');
  assert.equal(ctor!.name, 'Inner');
  assert.equal(ctor!.ownerClassName, 'Inner');
});

test('a doubly-nested class attributes a method to its own IMMEDIATE (innermost) enclosing class', () => {
  const doublyNested = `public class Outer {
  public static class Middle {
    public static class Inner {
      public void deepMethod() {
        doDeepWork();
      }
    }
  }
}
`;
  const caps = extractCapabilities('Outer.java', doublyNested);
  const deepMethod = caps.find((c) => c.name === 'deepMethod')!;
  assert.ok(deepMethod);
  assert.equal(deepMethod.ownerClassName, 'Inner');
});

test('two SIBLING (non-nested) classes in one file each get their own methods correctly attributed', () => {
  const twoSiblingClasses = `public class First {
  public void firstMethod() {
    doFirstWork();
  }
}

class Second {
  public void secondMethod() {
    doSecondWork();
  }
}
`;
  const caps = extractCapabilities('First.java', twoSiblingClasses);
  const firstMethod = caps.find((c) => c.name === 'firstMethod')!;
  const secondMethod = caps.find((c) => c.name === 'secondMethod')!;
  assert.equal(firstMethod.ownerClassName, 'First');
  assert.equal(secondMethod.ownerClassName, 'Second');
});

const PYTHON_HELPER = `import psycopg2


class PostgresHelper:
    def __init__(self, conn):
        self.conn = conn

    def query_one(self, sql, params):
        """Runs a query."""
        return self._run(sql, params)

    def _run(self, sql, params):
        return None

    @staticmethod
    def build_dsn(host, port):
        return f"host={host} port={port}"


def standalone_helper(x):
    return x + 1


def _private_helper(x):
    return x
`;

test('extracts public/top-level Python functions and class methods, skipping ones starting with "_"', () => {
  const caps = extractCapabilities('postgres_helper.py', PYTHON_HELPER);
  const names = caps.map((c) => c.name);
  assert.ok(names.includes('query_one'));
  assert.ok(names.includes('standalone_helper'));
  assert.ok(names.includes('build_dsn'));
  assert.ok(!names.includes('_run'), 'a leading-underscore method must not be extracted');
  assert.ok(!names.includes('_private_helper'), 'a leading-underscore top-level function must not be extracted');
});

test('__init__ is extracted and tagged as a constructor', () => {
  const caps = extractCapabilities('postgres_helper.py', PYTHON_HELPER);
  const ctor = caps.find((c) => c.name === '__init__');
  assert.ok(ctor);
  assert.equal(ctor!.kind, 'constructor');
  assert.equal(ctor!.ownerClassName, 'PostgresHelper');
});

test('a top-level Python function has no ownerClassName', () => {
  const caps = extractCapabilities('postgres_helper.py', PYTHON_HELPER);
  const standalone = caps.find((c) => c.name === 'standalone_helper')!;
  assert.equal(standalone.ownerClassName, undefined);
});

test('a Python method\'s excerpt includes a preceding decorator line', () => {
  const caps = extractCapabilities('postgres_helper.py', PYTHON_HELPER);
  const dsn = caps.find((c) => c.name === 'build_dsn')!;
  assert.match(dsn.excerpt, /@staticmethod/);
  assert.match(dsn.excerpt, /def build_dsn/);
});

test('a Python method\'s excerpt stops before the next sibling method', () => {
  const caps = extractCapabilities('postgres_helper.py', PYTHON_HELPER);
  const queryOne = caps.find((c) => c.name === 'query_one')!;
  assert.match(queryOne.excerpt, /return self\._run\(sql, params\)/);
  assert.doesNotMatch(queryOne.excerpt, /def _run/);
});

// --- F03: "async def" is no longer silently missed --------------------------

test('a top-level "async def" function IS extracted (the reproduced F03 bug — the old pattern only matched plain "def")', () => {
  const asyncFile = `async def fetch_row(sql):
    return await run(sql)
`;
  const caps = extractCapabilities('client.py', asyncFile);
  const fetchRow = caps.find((c) => c.name === 'fetch_row');
  assert.ok(fetchRow, 'an async top-level function must be found');
  assert.equal(fetchRow!.kind, 'method');
  assert.match(fetchRow!.signature, /^async def fetch_row/);
});

test('an "async def" METHOD inside a class is extracted with the correct owner', () => {
  const asyncMethodFile = `class Client:
    async def fetch_row(self, sql):
        return await self.run(sql)
`;
  const caps = extractCapabilities('client.py', asyncMethodFile);
  const fetchRow = caps.find((c) => c.name === 'fetch_row');
  assert.ok(fetchRow);
  assert.equal(fetchRow!.ownerClassName, 'Client');
});

test('a leading-underscore "async def" function is still skipped, same as a plain private def', () => {
  const asyncPrivate = `async def _internal_fetch(sql):
    return await run(sql)
`;
  assert.deepEqual(extractCapabilities('client.py', asyncPrivate), []);
});

// --- F03: a function NESTED inside another function is excluded -------------

test('a Python function nested inside ANOTHER function is NOT extracted as its own capability (the reproduced F03 bug)', () => {
  const withNestedFunction = `def outer_helper(items):
    def inner_transform(item):
        return item.upper()

    return [inner_transform(i) for i in items]
`;
  const caps = extractCapabilities('helper.py', withNestedFunction);
  const names = caps.map((c) => c.name);
  assert.ok(names.includes('outer_helper'), 'the real, independently-callable outer function must still be extracted');
  assert.ok(!names.includes('inner_transform'), 'a function nested inside another function is not independently callable and must never be fabricated as its own capability');
});

test('a function nested inside a METHOD (not a plain function) is also excluded, and the method\'s own owner is unaffected', () => {
  const nestedInMethod = `class Client:
    def run_batch(self, items):
        def format_one(item):
            return str(item)

        return [format_one(i) for i in items]
`;
  const caps = extractCapabilities('client.py', nestedInMethod);
  const runBatch = caps.find((c) => c.name === 'run_batch');
  assert.ok(runBatch);
  assert.equal(runBatch!.ownerClassName, 'Client');
  assert.ok(!caps.some((c) => c.name === 'format_one'));
});

test('a method inside a Python class NESTED inside another class is attributed to the innermost (nested) class', () => {
  const nestedClass = `class Outer:
    class Inner:
        def inner_method(self):
            return 1

    def outer_method(self):
        return 2
`;
  const caps = extractCapabilities('nested.py', nestedClass);
  const innerMethod = caps.find((c) => c.name === 'inner_method')!;
  const outerMethod = caps.find((c) => c.name === 'outer_method')!;
  assert.ok(innerMethod);
  assert.ok(outerMethod);
  assert.equal(innerMethod.ownerClassName, 'Inner');
  assert.equal(outerMethod.ownerClassName, 'Outer');
});

test('a normal (non-nested) function DEFINED AFTER a function containing a nested helper is still extracted correctly, unaffected', () => {
  const mixedFile = `def outer_helper(items):
    def inner_transform(item):
        return item.upper()

    return [inner_transform(i) for i in items]


def another_top_level(x):
    return x + 1
`;
  const caps = extractCapabilities('helper.py', mixedFile);
  const names = caps.map((c) => c.name);
  assert.ok(names.includes('outer_helper'));
  assert.ok(names.includes('another_top_level'));
  assert.ok(!names.includes('inner_transform'));
  const anotherTopLevel = caps.find((c) => c.name === 'another_top_level')!;
  assert.equal(anotherTopLevel.ownerClassName, undefined);
});

test('an unsupported file extension extracts zero capabilities (whole-file fallback)', () => {
  assert.deepEqual(extractCapabilities('config.yml', 'key: value\n'), []);
});

test('empty file content extracts zero capabilities without throwing', () => {
  assert.deepEqual(extractCapabilities('Empty.java', ''), []);
  assert.deepEqual(extractCapabilities('empty.py', ''), []);
});

// --- capabilitiesForFile (always non-empty, whole-file fallback) ---------

test('capabilitiesForFile returns the real extracted capabilities when there are any', () => {
  const caps = capabilitiesForFile('PostgresHelper.java', JAVA_HELPER);
  assert.ok(caps.length > 1);
  assert.ok(caps.every((c) => c.kind !== 'whole-file'));
});

test('capabilitiesForFile falls back to ONE synthetic whole-file capability for a config/ambiguous file', () => {
  const caps = capabilitiesForFile('config.yml', 'key: value\nother: 1\n');
  assert.equal(caps.length, 1);
  assert.equal(caps[0].kind, 'whole-file');
  assert.equal(caps[0].name, 'config');
  assert.equal(caps[0].excerpt, 'key: value\nother: 1\n');
});

test('capabilitiesForFile falls back to ONE synthetic whole-file capability when a .java file has no PUBLIC methods', () => {
  const allPrivate = `public class Internal {\n  private void helper() {}\n}\n`;
  const caps = capabilitiesForFile('Internal.java', allPrivate);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].kind, 'whole-file');
  assert.equal(caps[0].name, 'Internal');
});

test('capabilitiesForFile never returns an empty list, even for empty content', () => {
  assert.equal(capabilitiesForFile('Empty.java', '').length, 1);
  assert.equal(capabilitiesForFile('weird-no-extension', 'anything').length, 1);
});

// --- A09: extractAllCallableUnitsForDependencyDiscovery() — the COMPLETE
// same-file callable surface, for dependency discovery ONLY ---------------

test('A09: extractAllCallableUnitsForDependencyDiscovery finds a PRIVATE Java method that extractCapabilities() (public-only) never does', () => {
  const java = `public class IdHelper {\n  public int normalize(int id) {\n    return adjust(id);\n  }\n\n  private int adjust(int id) {\n    return id + 1;\n  }\n}\n`;
  const publicOnly = extractCapabilities('IdHelper.java', java);
  assert.deepEqual(publicOnly.map((c) => c.name), ['normalize'], 'sanity check: the private helper is genuinely invisible to public-only extraction');

  const allCallable = extractAllCallableUnitsForDependencyDiscovery('IdHelper.java', java);
  const names = allCallable.map((c) => c.name).sort();
  assert.deepEqual(names, ['adjust', 'normalize']);
});

test('A09: extractAllCallableUnitsForDependencyDiscovery finds a PROTECTED Java method too', () => {
  const java = `public class Base {\n  public void run() {\n    hook();\n  }\n\n  protected void hook() {}\n}\n`;
  const allCallable = extractAllCallableUnitsForDependencyDiscovery('Base.java', java);
  assert.ok(allCallable.some((c) => c.name === 'hook'));
});

test('A09: extractAllCallableUnitsForDependencyDiscovery does NOT match a bare, unmarked package-private Java method — a documented, deliberate scope limit', () => {
  const java = `public class Base {\n  public void run() {\n    hook();\n  }\n\n  void hook() {}\n}\n`;
  const allCallable = extractAllCallableUnitsForDependencyDiscovery('Base.java', java);
  assert.ok(!allCallable.some((c) => c.name === 'hook'), 'an unmarked package-private method is a documented remaining gap, not a false positive to guard against here');
});

test('A09: extractAllCallableUnitsForDependencyDiscovery finds an underscore-prefixed Python function that extractCapabilities() (public-only) never does', () => {
  const python = 'def normalize(id):\n    return _adjust(id)\n\n\ndef _adjust(id):\n    return id + 1\n';
  const publicOnly = extractCapabilities('id_helper.py', python);
  assert.deepEqual(publicOnly.map((c) => c.name), ['normalize'], 'sanity check: the underscore-prefixed helper is genuinely invisible to public-only extraction');

  const allCallable = extractAllCallableUnitsForDependencyDiscovery('id_helper.py', python);
  const names = allCallable.map((c) => c.name).sort();
  assert.deepEqual(names, ['_adjust', 'normalize']);
});

test('A09: extractAllCallableUnitsForDependencyDiscovery is UNCAPPED — finds a callable beyond MAX_CAPABILITIES_PER_FILE', () => {
  const manyMethods = Array.from({ length: MAX_CAPABILITIES_PER_FILE + 3 }, (_, i) => `  public void op${i}() {}\n`).join('');
  const java = `public class Big {\n${manyMethods}}\n`;
  const capped = extractCapabilities('Big.java', java);
  assert.equal(capped.length, MAX_CAPABILITIES_PER_FILE, 'sanity check: generation-facing extraction really is capped');

  const allCallable = extractAllCallableUnitsForDependencyDiscovery('Big.java', java);
  assert.equal(allCallable.length, MAX_CAPABILITIES_PER_FILE + 3, 'dependency discovery must see every real callable, including those beyond the generation cap');
});

test('A09: extractAllCallableUnitsForDependencyDiscovery never mistakes a control-flow construct (else if / catch / for / while / switch) for a callable', () => {
  const java =
    'public class Widget {\n' +
    '  public void run(int x) {\n' +
    '    if (x > 0) {\n' +
    '      doThing();\n' +
    '    } else if (x < 0) {\n' +
    '      doOtherThing();\n' +
    '    }\n' +
    '    try {\n' +
    '      doThing();\n' +
    '    } catch (Exception e) {\n' +
    '      handle(e);\n' +
    '    }\n' +
    '    for (int i = 0; i < x; i++) {\n' +
    '      doThing();\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  private void doThing() {}\n' +
    '  protected void doOtherThing() {}\n' +
    '  private void handle(Exception e) {}\n' +
    '}\n';
  const allCallable = extractAllCallableUnitsForDependencyDiscovery('Widget.java', java);
  const names = allCallable.map((c) => c.name).sort();
  assert.deepEqual(names, ['doOtherThing', 'doThing', 'handle', 'run'], 'no control-flow keyword must ever be misdetected as a callable name');
});
