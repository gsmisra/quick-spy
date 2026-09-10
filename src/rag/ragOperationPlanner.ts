/**
 * Shared request-to-operations layer (Phase 3) — used by BOTH Standard
 * mode (objectSpyPanel.ts) and Total Agentic Mode (agenticModeController.ts)
 * to turn "what does this request actually need" into a list of
 * independently-retrievable operations, instead of one flattened whole-
 * query string. A single query capped at `topK` matches can't surface 3
 * DIFFERENT required capabilities; retrieving PER OPERATION (see
 * ragOperationRetrieval.ts) removes that ceiling — see
 * rag/ragRetriever.ts's own doc comment on why `topK` stayed low, and this
 * module's job is to give retrieval something more precise than a whole
 * scenario to score against in the first place.
 *
 * Deliberately pure, zero `vscode` import, so this is directly unit
 * tested. Every planner function here does STRUCTURAL decomposition
 * (Gherkin steps, API fields, ingested-file segments) — none of them do
 * anything resembling semantic understanding of "what this request really
 * needs"; `method` on every `OperationPlan` says exactly which structural
 * strategy produced it, so a caller (or log line) never overstates this as
 * "operation decomposition" when it was really just following existing
 * selection/segmentation boundaries.
 */

export interface RagOperation {
  /** Stable within one plan — NOT guaranteed stable across repeated calls
   * with different inputs (e.g. re-ordering selected steps changes the
   * indices these IDs are derived from). Used only for diagnostics/dedup
   * bookkeeping within a single retrieval pass, never persisted. */
  operationId: string;
  /** The actual text this operation's retrieval query is run against. */
  text: string;
}

export type OperationPlanMethod = 'gherkin-steps' | 'api-fields' | 'agentic-segments' | 'unstructured-fallback';

export interface OperationPlan {
  operations: RagOperation[];
  /** How these operations were derived — see this file's own top-level doc
   * comment on why this is surfaced explicitly rather than left implicit. */
  method: OperationPlanMethod;
}

function nonEmpty(text: string | undefined): text is string {
  return !!text && text.trim().length > 0;
}

/**
 * Derives operations from a Gherkin scenario's already-SELECTED step texts
 * (see bdd/gherkinParser.ts's `buildFilteredScenarioParts()` — this
 * function receives ONLY what selection already filtered down to; it never
 * sees, and therefore can never reintroduce, a deselected step). One
 * operation per selected step. `backgroundText` (a scenario's Background,
 * never individually selectable — always sent in full, matching existing
 * behavior) and `exampleTexts` (a Scenario Outline's placeholder data) are
 * folded into EVERY step operation's own query text as shared context
 * rather than becoming operations of their own — they carry real
 * retrieval-relevant vocabulary (e.g. a Background's "Given I am logged in
 * as an admin" often implies an auth helper is needed for EVERY step that
 * follows) but aren't themselves a distinct callable capability request.
 */
export function planOperationsFromGherkinSteps(
  stepTexts: string[],
  backgroundText: string | undefined,
  exampleTexts: string[]
): OperationPlan {
  const sharedContext = [backgroundText, ...exampleTexts].filter(nonEmpty).join('\n');
  if (stepTexts.length === 0) {
    // Nothing selected — the only thing left to retrieve against (if
    // anything) is the shared context itself, as a single operation.
    return {
      operations: nonEmpty(sharedContext) ? [{ operationId: 'op-context', text: sharedContext }] : [],
      method: 'gherkin-steps'
    };
  }
  const operations = stepTexts
    .map((stepText, i) => ({ operationId: `op-${i}`, text: nonEmpty(sharedContext) ? `${sharedContext}\n${stepText}` : stepText }))
    .filter((op) => nonEmpty(op.text));
  return { operations, method: 'gherkin-steps' };
}

/**
 * Derives ONE operation from an API request's own method/URL plus
 * sanitized body field names (rag/../api/apiRequestDetails.ts's
 * `extractApiBodyFieldNames()` — field NAMES only, never values, and never
 * an invented assertion this extension didn't actually observe in the
 * request itself). A single API call has no natural sub-operation
 * boundary the way a multi-step Gherkin scenario does, so this
 * deliberately produces exactly one operation rather than fabricating a
 * decomposition that doesn't exist.
 */
export function planOperationFromApiRequest(methodAndUrl: string, bodyFieldNames: string[]): OperationPlan {
  const text = [methodAndUrl.trim(), bodyFieldNames.join(' ')].filter(nonEmpty).join('\n');
  return { operations: nonEmpty(text) ? [{ operationId: 'api-request', text }] : [], method: 'api-fields' };
}

/** How far back from a target chunk boundary `chunkTextForOperations()`
 * will look for a whitespace break, expressed as a fraction of the target
 * chunk size — e.g. 0.5 means "only break early if that saves at least
 * half a chunk's worth of length," so a chunk is never made needlessly
 * tiny just to avoid splitting one word. Below that threshold, splitting
 * mid-word is accepted; retrieval only reads these chunks as plain
 * bag-of-words text (rag/tfidfEmbeddings.ts), so an occasional split word
 * costs nothing beyond that one token. */
const CHUNK_BREAK_SEARCH_FRACTION = 0.5;

/** Splits `text` into a BOUNDED number of chunks that together cover the
 * WHOLE text — never just its first `targetCharsPerChunk` characters (the
 * bug this fixes — F13: a distinctive requirement mentioned only near the
 * END of a long ingested-file segment previously never influenced RAG
 * retrieval at all, even though the model itself DID receive the full
 * segment for actual generation — see agenticModeController.ts's own
 * `buildOperationPlan()`, the only caller). Adaptively grows each chunk's
 * size (never shrinks below `targetCharsPerChunk`) so the TOTAL chunk
 * count never exceeds `maxChunks`, regardless of how long `text` is — a
 * short text (already `<= targetCharsPerChunk`) produces exactly one
 * chunk containing it in full, UNCHANGED from a single bounded operation
 * (this is the OLD, pre-F13 behavior for anything that already fit within
 * the old budget). Breaks on a nearby whitespace boundary when there's one
 * close enough (`CHUNK_BREAK_SEARCH_FRACTION`) rather than blindly
 * mid-word, purely for readability of the resulting retrieval query text —
 * this has no effect on correctness either way. An empty/whitespace-only
 * `text` produces zero chunks. */
export function chunkTextForOperations(text: string, targetCharsPerChunk: number, maxChunks: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length <= targetCharsPerChunk) {
    return [trimmed];
  }

  const naiveChunkCount = Math.ceil(trimmed.length / targetCharsPerChunk);
  const chunkCount = Math.min(naiveChunkCount, maxChunks);
  const chunkSize = Math.ceil(trimmed.length / chunkCount);

  // A `for` loop bounded to EXACTLY `chunkCount` iterations — not a `while`
  // loop advancing by however far each whitespace-aware break happens to
  // land — is what actually guarantees the total chunk count never exceeds
  // `maxChunks`: shifting one boundary earlier (to land on whitespace)
  // only changes where THAT chunk ends, never how many chunks the loop
  // itself will run for. The FINAL iteration always takes everything
  // remaining (however much whitespace-drift left it as), so the last
  // chunk may end up a little larger than `chunkSize` — never a
  // correctness problem, and it's exactly what guarantees full coverage
  // of the text's own tail end (F13's own acceptance criterion).
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < chunkCount && start < trimmed.length; i++) {
    const isLast = i === chunkCount - 1;
    let end = isLast ? trimmed.length : Math.min(start + chunkSize, trimmed.length);
    if (!isLast) {
      const searchFrom = Math.max(start, end - Math.floor(chunkSize * CHUNK_BREAK_SEARCH_FRACTION));
      const lastSpace = trimmed.lastIndexOf(' ', end);
      const lastNewline = trimmed.lastIndexOf('\n', end);
      const breakAt = Math.max(lastSpace, lastNewline);
      if (breakAt >= searchFrom && breakAt > start) {
        end = breakAt;
      }
    }
    const chunk = trimmed.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end;
  }
  return chunks;
}

/**
 * Derives operations for Total Agentic Mode: one operation for the user's
 * own explicit free-text request (when non-empty), plus one operation PER
 * ingested file segment — never a single leading-characters slice of
 * everything concatenated together (the bug this replaces; see
 * agenticModeController.ts's own `buildRagQueryText()` doc comment for the
 * prior fix this supersedes with real per-file operations instead of a
 * shared query string). `fileSegments` should already be whatever bounded
 * excerpt(s) each file contributes — as of F13, agenticModeController.ts's
 * own `buildOperationPlan()` passes MULTIPLE chunks per file (via
 * `chunkTextForOperations()` above) rather than a single truncated prefix,
 * so a file can legitimately contribute several entries here, each
 * becoming its own operation; this function itself doesn't bound or
 * truncate anything, it just turns each given segment into its own
 * operation.
 */
export function planOperationsFromAgenticSegments(
  userRequest: string,
  fileSegments: { fileName: string; text: string }[]
): OperationPlan {
  const operations: RagOperation[] = [];
  if (nonEmpty(userRequest)) {
    operations.push({ operationId: 'user-request', text: userRequest });
  }
  fileSegments.forEach((segment, i) => {
    if (nonEmpty(segment.text)) {
      operations.push({ operationId: `file-${i}`, text: segment.text });
    }
  });
  return { operations, method: 'agentic-segments' };
}

/**
 * The fallback for anything with no more specific structure to decompose
 * (free-text chat instructions with no linked scenario, no API details,
 * not Agentic Mode) — exactly ONE operation wrapping the whole text.
 * Deliberately not "smart" — see this file's own top-level doc comment on
 * why a plain sentence-split here would be mislabeled as semantic
 * decomposition it isn't.
 */
export function planUnstructuredOperation(text: string): OperationPlan {
  return { operations: nonEmpty(text) ? [{ operationId: 'unstructured', text }] : [], method: 'unstructured-fallback' };
}

/** Prepends `sharedContext` (e.g. the chat box's free-text "Instant
 * instructions to LLM", which previously was unconditionally folded into
 * one combined whole-query string) onto EVERY operation in `plan`, same
 * treatment as Background/Examples text in
 * `planOperationsFromGherkinSteps()` — real retrieval-relevant vocabulary
 * that isn't itself a distinct callable-capability request. If `plan` has
 * no operations at all (nothing else to plan from) but `sharedContext`
 * itself is real content, this produces ONE operation for it rather than
 * losing it entirely — mirrors `planOperationsFromGherkinSteps()`'s own
 * "zero steps but real context" case. A no-op (returns `plan` unchanged)
 * when `sharedContext` is empty/whitespace-only. */
export function withSharedContext(plan: OperationPlan, sharedContext: string): OperationPlan {
  if (!nonEmpty(sharedContext)) {
    return plan;
  }
  if (plan.operations.length === 0) {
    return { operations: [{ operationId: 'shared-context', text: sharedContext }], method: plan.method };
  }
  return {
    operations: plan.operations.map((operation) => ({ ...operation, text: `${sharedContext}\n${operation.text}` })),
    method: plan.method
  };
}
