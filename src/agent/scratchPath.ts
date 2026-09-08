import * as path from 'path';

/**
 * Resolves `relativePath` against `scratchDir`, returning the resolved
 * absolute path ONLY if it stays within `scratchDir` — `null` on any escape
 * attempt (an absolute path, a `..` traversal that climbs back out, etc.).
 *
 * This is the one piece of security-critical logic behind the Verify & Fix
 * agent's `read_file` tool (see agent/verifyFixTools.ts): the agent's file
 * path argument ultimately originates from an LLM response, which this
 * extension must treat as untrusted input — no matter how well-behaved
 * Copilot normally is, a tool implementation must never let a model-supplied
 * path reach outside the one disposable scratch project it's allowed to
 * inspect. Deliberately a pure, dependency-free function (no `fs`, no
 * `vscode`) so it can be exercised directly by unit tests without any
 * extension-host scaffolding.
 */
export function resolveWithinScratchDir(scratchDir: string, relativePath: unknown): string | null {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    return null;
  }
  // Reject a rooted path outright (`path.resolve` would otherwise happily
  // honor "C:\Windows\System32\..." or "/etc/passwd" as its own absolute
  // path, ignoring `scratchDir` entirely) — `path.isAbsolute` catches both
  // POSIX and Windows forms.
  if (path.isAbsolute(relativePath)) {
    return null;
  }
  const base = path.resolve(scratchDir);
  const resolved = path.resolve(base, relativePath);
  // A trailing separator on `base` before the prefix check prevents a
  // sibling-directory false-accept — e.g. base "/a/scratch" must not admit
  // "/a/scratch-evil/secret" just because it shares the string prefix
  // "/a/scratch". The exact-match branch covers the (rare, harmless) case
  // of asking for the scratch directory itself.
  if (resolved === base) {
    return resolved;
  }
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  return resolved.startsWith(baseWithSep) ? resolved : null;
}
