import type { RagMatch } from '../rag/ragRetriever';

/**
 * Deterministic RAG traceability for the generated-code panel
 * (objectSpyPanel.ts's `runLlmRefinement()`) — deliberately its own file
 * with zero `vscode` import (objectSpyPanel.ts itself imports `vscode` for
 * real webview/workspace work, which would make this logic untestable
 * outside an Extension Host if it lived there too — the same pattern as
 * rag/ragRetriever.ts and llm/tokenBudget.ts), so the actual "what evidence
 * do we have that this component was called" logic is directly unit
 * tested. `relativePathOf` is injected rather than calling
 * `vscode.workspace.asRelativePath` directly, for the same reason.
 *
 * IMPORTANT — this module never claims VERIFIED use, only OBSERVED
 * evidence: retrieval and inclusion in the prompt happen unconditionally
 * (a candidate can be offered and never touched — see
 * rag/ragRetriever.ts's own "reuse ONLY the ones that genuinely fit, never
 * force one that doesn't" instruction, which explicitly permits the model
 * to use NONE of the retrieved helpers). The two checks below (a
 * traceability comment, or an import symbol appearing in the code) are
 * HEURISTIC static-text signals, not a real call-graph/AST verification —
 * a model could paste an import without calling anything from it, or add
 * the comment without following through, or genuinely call something this
 * heuristic fails to recognize. Every user-facing string this module
 * produces says "observed"/"detected", deliberately never "actually
 * used"/"verified" — that distinction is the whole point of this file.
 */

/** Whether `code` shows OBSERVED (heuristic, not verified) evidence that
 * `match` was called — checked two ways: (1) the model followed
 * rag/ragRetriever.ts's own "add a `RAG match: <id> (from <source file>)`
 * comment" instruction — best-effort, since a model doesn't always comply
 * with formatting instructions to the letter, and a comment alone doesn't
 * prove a real call follows it; or (2), independent of the model
 * remembering to comment at all, one of the recipe's OWN declared import
 * symbols for `language` appears anywhere in the generated code — a
 * textual signal, not confirmation that anything was actually invoked
 * from that import (an unused import, or a coincidental substring match,
 * would both satisfy this check too). Neither signal is proof — see this
 * file's own top-level doc comment. */
export function hasObservedCallEvidence(code: string, match: RagMatch, language: 'java' | 'python'): boolean {
  if (code.includes(`RAG match: ${match.id}`)) {
    return true;
  }
  const importSymbols = match.imports?.[language] ?? [];
  return importSymbols.some((imp) => imp.trim().length > 0 && code.includes(imp));
}

export interface TraceabilityBannerResult {
  /** `code`, with a banner prepended when at least one match had observed
   * call evidence — otherwise `code` with a brief honest note (matches
   * were offered but none showed evidence) or, when `matches` was empty to
   * begin with, `code` completely unchanged. */
  code: string;
  /** The subset of `matches` `hasObservedCallEvidence()` found a heuristic
   * signal for — callers should log this alongside `matches.length` to
   * surface the full retrieved -> included in prompt -> call observed
   * breakdown, never just the first two steps, and never describe this
   * list as "verified used." */
  observedMatches: RagMatch[];
}

/**
 * Prepends deterministic RAG traceability to the FINAL generated code
 * ourselves, never left to the model's own compliance with the
 * "add a comment" instruction (see that instruction's own doc comment in
 * rag/ragRetriever.ts — this banner is the guarantee; the inline comment
 * the model is asked to add near each actual call site is a best-effort
 * improvement on TOP of this, not a substitute for it).
 *
 * Lists only the recipes `hasObservedCallEvidence()` found a heuristic
 * signal for — `matches` here is already the "retrieved AND included in
 * the prompt" set, but inclusion in the prompt is not the same claim as
 * the model having called it, and a heuristic text-match is not the same
 * claim as a VERIFIED call either. A banner that listed every OFFERED
 * component regardless would establish "this was retrieved," not "there's
 * observed evidence of a call" — exactly the distinction this function
 * draws, and it draws it honestly: nothing here is ever labeled "actually
 * used" or "verified." A recipe with no observed evidence is silently
 * OMITTED from the banner itself (baking a "no evidence" note into every
 * generated file for every unused candidate would be noise a reviewer
 * doesn't want in committed test code), but `observedMatches` on the
 * returned result still lets the caller log the full breakdown to a
 * diagnostic channel.
 *
 * A no-op (`{ code, observedMatches: [] }`, `code` byte-for-byte
 * unchanged) when no RAG components were matched at all — a request RAG
 * had nothing to offer for costs nothing extra here either.
 */
export function prependRagTraceabilityBanner(
  code: string,
  matches: RagMatch[],
  language: 'java' | 'python',
  relativePathOf: (filePath: string) => string
): TraceabilityBannerResult {
  if (matches.length === 0) {
    return { code, observedMatches: [] };
  }
  const c = language === 'python' ? '#' : '//';
  const observedMatches = matches.filter((m) => hasObservedCallEvidence(code, m, language));
  if (observedMatches.length === 0) {
    // No heuristic evidence for anything — still worth a single honest
    // line (never silently drop this information) rather than either a
    // full banner implying components with no evidence were used, or
    // complete silence that looks identical to "RAG had nothing to offer"
    // from the code alone.
    return {
      code: `${c} (${matches.length} reusable component(s) were offered for this generation; no call evidence was observed in the code below.)\n\n${code}`,
      observedMatches: []
    };
  }
  const unobservedCount = matches.length - observedMatches.length;
  const banner = [
    `${c} ── RAG-matched reusable component(s) — call evidence OBSERVED (heuristic, not verified) ──`,
    ...observedMatches.map((m) => `${c} - "${m.title}" (id: ${m.id}) — from ${relativePathOf(m.filePath)}`),
    unobservedCount > 0 ? `${c} (${unobservedCount} additional component(s) were offered but showed no observed call evidence, omitted above.)` : undefined,
    `${c} ────────────────────────────────────────────────────────────────────`,
    ''
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
  return { code: banner + code, observedMatches };
}
