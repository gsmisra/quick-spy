import { EmbeddingProvider } from './ragEmbeddingProvider';

/**
 * A generic HTTP `EmbeddingProvider` (Phase 6) — POSTs to a USER-CONFIGURED
 * endpoint (see the Settings panel's "Hybrid Retrieval" section and
 * rag/ragHybridConfig.ts) using the OpenAI-compatible embeddings request/
 * response shape (`{model, input}` in, `{data:[{embedding, index}]}` out) —
 * the de facto standard several real providers implement verbatim (OpenAI
 * itself, Azure OpenAI, and self-hosted OpenAI-compatible servers such as
 * Ollama/LM Studio/text-embeddings-inference), so this one implementation
 * covers a genuinely useful range of real deployments without hand-rolling
 * a provider-specific client for each.
 *
 * This is the ONLY place in this codebase that can send a recipe/query's
 * TEXT to an external network endpoint for embedding — and it only ever
 * runs when a user has explicitly configured an endpoint AND a model (see
 * rag/ragHybridConfig.ts's `resolveHybridRetrieveMatches()`), never as a
 * side effect of anything else. No credentials are ever hardcoded here;
 * an API key, when configured, is supplied by the caller and sent only as
 * this one request's own `Authorization` header, never logged or written
 * anywhere.
 *
 * Request/response building (`buildEmbeddingRequestBody()`,
 * `parseEmbeddingResponse()`) is pure and directly unit-tested; the actual
 * network call is reviewed, not unit tested — matching this codebase's
 * "pure logic tested, network/vscode glue reviewed" convention (e.g.
 * llm/copilotClient.ts).
 */

export interface HttpEmbeddingConfig {
  /** Full URL to POST embedding requests to. */
  endpoint: string;
  /** Sent as the request body's `model` field — meaning is entirely
   * provider-defined (e.g. "text-embedding-3-small" for OpenAI, a
   * locally-loaded model name for a self-hosted server). */
  model: string;
  /** Sent as `Authorization: Bearer <apiKey>` when present. Never persisted
   * by this module itself — see rag/ragHybridConfig.ts for where it's
   * actually stored (VS Code SecretStorage, never plain settings). */
  apiKey?: string;
  /** A10: overrides `DEFAULT_EMBEDDING_TIMEOUT_MS` — exposed for tests
   * (a real 30s wait is never acceptable in a test suite) and for a future
   * Settings affordance; every real caller today omits this and gets the
   * default. */
  timeoutMs?: number;
}

/** A10: how long a single embedding HTTP request is allowed to run before
 * it's aborted and reported as a (non-cancellation) failure — see
 * `EmbeddingProvider.embedQuery()`'s own doc comment on why EVERY real
 * network-calling implementation must bound this regardless of whether a
 * caller supplied its own cancellation `signal`. Generous (embedding a
 * whole corpus batch in one request is legitimately slower than a single
 * short call) but finite — before this fix, `fetch()` had NO timeout at
 * all, so an unresponsive/hung endpoint left hybrid retrieval (and, once
 * its failure escaped uncaught — see ragHybridRetriever.ts's own A10 fix —
 * the ENTIRE code-generation request) stuck indefinitely. */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;

/** Thrown specifically when the REQUEST'S OWN bounded timeout (never a
 * caller-supplied cancellation `signal`) is what aborted a request — kept
 * as its own distinct, recognizable error type (rather than the generic
 * `AbortError` a plain `fetch()` abort produces) so a caller
 * (ragHybridRetriever.ts) never has to guess, from a bare `AbortError`
 * alone, whether "the network was just slow" or "the caller explicitly
 * cancelled this" — the two demand OPPOSITE responses (A10: the former
 * should degrade gracefully to lexical-only retrieval and report the
 * fallback; the latter must stop work entirely, never start a fallback
 * request of its own). */
export class EmbeddingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Embedding request timed out after ${timeoutMs}ms.`);
    this.name = 'EmbeddingTimeoutError';
  }
}

interface BoundedSignal {
  /** Aborts when EITHER the caller's own `callerSignal` aborts OR
   * `timeoutMs` elapses, whichever happens first. */
  signal: AbortSignal;
  /** Only meaningful to call AFTER the operation using `signal` has
   * settled — true iff the TIMEOUT (not `callerSignal`) is what actually
   * triggered the abort. */
  timedOut(): boolean;
  /** MUST be called exactly once the operation using `signal` has settled
   * (success or failure) — clears the timer and detaches the listener on
   * `callerSignal`, so neither outlives the request they were created
   * for. */
  cleanup(): void;
}

/** Combines an optional caller-supplied `AbortSignal` with a fixed bounded
 * timeout into ONE signal a single `fetch()` call can use — see
 * `BoundedSignal`'s own doc comment. Deliberately hand-rolled (a manual
 * `AbortController` + `setTimeout`, rather than relying on
 * `AbortSignal.any([callerSignal, AbortSignal.timeout(ms)])`) so exactly
 * WHICH one fired is always reliably known afterward via `timedOut()`,
 * without depending on a specific runtime's exact error-naming behavior
 * for a timeout-triggered abort — this needs to work identically across
 * whatever Node version the Extension Host itself bundles. */
function boundedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): BoundedSignal {
  const controller = new AbortController();
  let dueToTimeout = false;
  const timer = setTimeout(() => {
    dueToTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => dueToTimeout,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

/** The OpenAI-compatible embeddings request body — `input` accepts a batch
 * (an array of strings) so a whole corpus can usually be embedded in ONE
 * request rather than one round-trip per recipe. */
export function buildEmbeddingRequestBody(model: string, inputs: string[]): { model: string; input: string[] } {
  return { model, input: inputs };
}

/** Parses an OpenAI-compatible embeddings response
 * (`{data: [{embedding: number[], index?: number}, ...]}`) back into a
 * plain `number[][]`, ONE vector per input, in the SAME order the inputs
 * were sent — a provider isn't required to preserve request order in its
 * response array, so entries are re-sorted by their own `index` field when
 * present (falling back to response array order when it's absent, per the
 * schema's own optionality). Throws a clear, specific error for any shape
 * that doesn't match — including a vector count mismatch — rather than
 * returning a partial/misaligned result that would silently corrupt every
 * downstream similarity computation.
 *
 * A11: an entry's `index` is validated to form an EXACT bijection onto
 * `[0, expectedCount)` — no duplicates, none out of range, none missing —
 * before it's ever trusted to reorder anything. The OLD code sorted by
 * whatever numeric `index` each entry claimed and then mapped by the
 * SORTED POSITION, so a response with the RIGHT total count but a
 * garbled/duplicated/out-of-range index set (e.g. two entries both
 * claiming `index: 0`, or `index: 99` for a 2-document batch) still
 * "succeeded" — silently corresponding a vector to the WRONG input text,
 * with no error at all. Every returned vector is also confirmed to share
 * the SAME dimensionality as every other one in this same batch — a
 * response mixing vector lengths across entries is exactly the
 * "incompatible vectors" shape `ragHybridRetriever.ts`'s own
 * `cosineSimilarity()` (A11) refuses to silently paper over by truncating,
 * so it's caught here too, at the earliest point the full batch is
 * actually in hand. */
export function parseEmbeddingResponse(raw: unknown, expectedCount: number): number[][] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).data)) {
    throw new Error('Unexpected embedding response shape — expected an OpenAI-compatible {"data":[{"embedding":[...]}]} JSON body.');
  }
  const data = (raw as { data: unknown[] }).data;
  if (data.length !== expectedCount) {
    throw new Error(`Embedding response returned ${data.length} vector(s), expected ${expectedCount}.`);
  }

  const withIndex = data.map((entry, i) => {
    const record = entry as Record<string, unknown> | null;
    const index = typeof record?.index === 'number' ? record.index : i;
    return { record, index };
  });

  const seenIndices = new Set<number>();
  for (const { index } of withIndex) {
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
      throw new Error(`Embedding response entry has an out-of-range "index" (${index}) — expected an integer between 0 and ${expectedCount - 1}.`);
    }
    if (seenIndices.has(index)) {
      throw new Error(`Embedding response has more than one entry claiming "index" ${index} — cannot reliably correspond vectors to their inputs.`);
    }
    seenIndices.add(index);
  }

  withIndex.sort((a, b) => a.index - b.index);

  const vectors = withIndex.map(({ record }, position) => {
    const embedding = record?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`Embedding response entry at position ${position} is missing a valid numeric "embedding" array.`);
    }
    return embedding as number[];
  });

  const dimension = vectors[0]?.length;
  const mismatched = vectors.find((vector) => vector.length !== dimension);
  if (mismatched) {
    throw new Error(`Embedding response mixes vectors of different dimensions (${dimension} vs ${mismatched.length}) within the same batch.`);
  }

  return vectors;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;

  constructor(private readonly config: HttpEmbeddingConfig) {
    this.id = `http:${config.endpoint}:${config.model}`;
  }

  async embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const body = buildEmbeddingRequestBody(this.config.model, texts);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    // A10: bounded regardless of whether the caller passed its own
    // `signal` — see `DEFAULT_EMBEDDING_TIMEOUT_MS`'s own doc comment for
    // why an unbounded fetch() here used to be able to hang indefinitely.
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS;
    const bounded = boundedSignal(signal, timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: bounded.signal });
    } catch (err) {
      // A10: distinguish "our OWN timeout fired" (a real failure — the
      // endpoint is unresponsive) from anything else (a genuine network
      // error, OR the caller's own `signal` aborting this request on
      // purpose) — the latter is re-thrown completely as-is (including a
      // plain AbortError from caller cancellation) so
      // ragHybridRetriever.ts can tell them apart by checking `signal?.aborted`
      // itself, never by trying to sniff this error's own shape.
      throw bounded.timedOut() ? new EmbeddingTimeoutError(timeoutMs) : err;
    } finally {
      bounded.cleanup();
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Embedding request to ${this.config.endpoint} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
    }
    const json = await response.json();
    return parseEmbeddingResponse(json, texts.length);
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vector] = await this.embedDocuments([text], signal);
    return vector;
  }
}
