import * as vscode from 'vscode';
import { ObjectSpySettings } from '../settings/settingsStore';
import { EmbeddingProvider } from './ragEmbeddingProvider';
import { HttpEmbeddingProvider } from './ragHttpEmbeddingProvider';
import { CachingEmbeddingProvider } from './ragEmbeddingCache';
import { RetrieveMatchesFn } from './ragOperationRetrieval';
import { retrieveHybridMatches } from './ragHybridRetriever';

/**
 * The vscode-aware wiring for Phase 6's optional hybrid retrieval — owns
 * the ONE place an embedding-provider API key is stored (VS Code's own
 * `SecretStorage`, OS-keychain-backed, same posture as
 * security/secretVault.ts's master key — NEVER `globalState`/settings.json,
 * NEVER logged), and turns the current settings into a
 * `ragOperationRetrieval.ts`-compatible retrieval function ONLY when hybrid
 * mode is genuinely, fully configured. Reviewed, not directly unit tested
 * (vscode-dependent glue) — the actual fusion/ranking/caching logic this
 * wires together lives in, and is unit tested from, ragHybridRetriever.ts,
 * ragReciprocalRankFusion.ts, and ragEmbeddingCache.ts.
 */

/** A10: bridges a real `vscode.CancellationToken` into a plain, web-standard
 * `AbortSignal` — the ONE place this translation happens, so every module
 * BELOW this one (ragHybridRetriever.ts, ragEmbeddingCache.ts,
 * ragHttpEmbeddingProvider.ts) can stay completely `vscode`-free while
 * still genuinely honoring a real cancellation source when a caller has
 * one. `undefined` in, `undefined` out — a caller with no cancellation
 * token available (e.g. a live token-count estimate with nothing to
 * cancel) simply gets no `signal`, which is exactly today's prior
 * behavior (the embedding provider's own bounded timeout — see
 * ragHttpEmbeddingProvider.ts's `DEFAULT_EMBEDDING_TIMEOUT_MS` — still
 * applies regardless). Already-cancelled is handled immediately (no need
 * to wait for the event) so a token cancelled just before this is called
 * is never silently treated as "not cancelled." */
export function cancellationTokenToAbortSignal(token: vscode.CancellationToken | undefined): AbortSignal | undefined {
  if (!token) {
    return undefined;
  }
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}

const SEMANTIC_API_KEY_SECRET = 'SoftPlay.rag.semanticApiKey';

export async function getSemanticApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SEMANTIC_API_KEY_SECRET);
}

/** Stores (or, given an empty string, clears) the semantic-embedding
 * provider's API key. Called only from the Settings panel's own "Save Key"
 * action — never anywhere else. */
export async function setSemanticApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  if (apiKey) {
    await context.secrets.store(SEMANTIC_API_KEY_SECRET, apiKey);
  } else {
    await context.secrets.delete(SEMANTIC_API_KEY_SECRET);
  }
  cachedProvider = undefined; // the key just changed — never let a stale provider (old key baked into its closure) keep being reused
}

interface CachedProviderEntry {
  /** Identifies the (endpoint, model, apiKey) triple this provider
   * instance was built from — a `CachingEmbeddingProvider`'s cache is only
   * valid for the EXACT embedding space it was populated from, so any
   * change to any of these three must throw the old instance (and its
   * cache) away rather than keep reusing vectors from a different
   * embedding space. */
  key: string;
  provider: CachingEmbeddingProvider;
}

// Held across calls within one extension-host session so the caching layer
// (ragEmbeddingCache.ts) actually accumulates hits across repeated
// generation requests, instead of starting a fresh, empty cache — and
// making a fresh network round-trip for every single recipe — on every
// call. Rebuilt (see the `key` check below) whenever the configuration
// itself changes.
let cachedProvider: CachedProviderEntry | undefined;

async function getOrBuildSemanticProvider(context: vscode.ExtensionContext, settings: ObjectSpySettings): Promise<EmbeddingProvider | undefined> {
  if (!settings.ragHybridEnabled || !settings.ragSemanticEndpoint.trim() || !settings.ragSemanticModel.trim()) {
    // "Semantic mode must be explicitly configured" — the toggle ALONE is
    // never enough; an endpoint and a model must also both be set. This is
    // the ONE gate everything else in hybrid retrieval sits behind.
    return undefined;
  }
  const apiKey = await getSemanticApiKey(context);
  const key = `${settings.ragSemanticEndpoint}|${settings.ragSemanticModel}|${apiKey ?? ''}`;
  if (cachedProvider && cachedProvider.key === key) {
    return cachedProvider.provider;
  }
  const provider = new CachingEmbeddingProvider(new HttpEmbeddingProvider({ endpoint: settings.ragSemanticEndpoint, model: settings.ragSemanticModel, apiKey }));
  cachedProvider = { key, provider };
  return provider;
}

export interface ResolveHybridRetrieveMatchesOptions {
  /** A10: the CURRENT generation request's own cancellation token, when the
   * caller has one (every real "Start AI ... Generation" call site does;
   * a live token-count estimate does not) — bridged into a plain
   * `AbortSignal` (see `cancellationTokenToAbortSignal()`) and forwarded
   * to EVERY per-operation hybrid retrieval call this one configuration
   * resolves to, for the lifetime of ONE generation. */
  cancellationToken?: vscode.CancellationToken;
  /** A10: called AT MOST ONCE across every per-operation retrieval call
   * this ONE resolved function makes for ONE generation, the first time
   * (if ever) the semantic ranker fails for a reason other than
   * cancellation — see `HybridRetrievalOptions.onSemanticFailure`'s own
   * doc comment in ragHybridRetriever.ts for why de-duplication belongs
   * here rather than in that lower-level function, which has no notion of
   * "one generation" spanning multiple calls. Optional; a caller that
   * doesn't care to report this simply never gets told. */
  onSemanticFailure?: (message: string) => void;
}

/** Returns a `retrieveForOperations()`-compatible retrieval function bound
 * to hybrid (lexical + semantic RRF fusion) retrieval — or `undefined`
 * when hybrid mode isn't genuinely configured, in which case every call
 * site falls back to `retrieveForOperations()`'s own default
 * (plain lexical `retrieveRagMatches()`) with ZERO behavior change. */
export async function resolveHybridRetrieveMatches(
  context: vscode.ExtensionContext,
  settings: ObjectSpySettings,
  options: ResolveHybridRetrieveMatchesOptions = {}
): Promise<RetrieveMatchesFn | undefined> {
  const provider = await getOrBuildSemanticProvider(context, settings);
  if (!provider) {
    return undefined;
  }
  const signal = cancellationTokenToAbortSignal(options.cancellationToken);
  // A10: "at most once per generation" — a plain boolean closed over by
  // every per-operation call the RETURNED function makes is enough, since
  // a fresh one of these is resolved once per generation (see
  // agenticModeController.ts's/objectSpyPanel.ts's own call sites) and
  // never reused across two different generations.
  let hasReportedSemanticFailure = false;
  const onSemanticFailure = options.onSemanticFailure
    ? (message: string) => {
        if (hasReportedSemanticFailure) {
          return;
        }
        hasReportedSemanticFailure = true;
        options.onSemanticFailure!(message);
      }
    : undefined;
  return (index, queryText, language, automationMode, k, staleFilePaths) =>
    retrieveHybridMatches(index, provider, queryText, language, automationMode, { topK: k, staleFilePaths, signal, onSemanticFailure });
}

export interface EmbeddingProviderTestResult {
  ok: boolean;
  message: string;
}

/** "Test Connection" (Settings panel) — the ONLY place this extension ever
 * calls a configured semantic endpoint OUTSIDE of an actual retrieval
 * request, so a user can confirm their endpoint/model/key are valid before
 * relying on them. Embeds one short, generic word — never real recipe/
 * query content — and reports success (with the returned vector's
 * dimensionality, a useful sanity signal) or a readable failure reason.
 * Never throws — always resolves to a result the caller can display
 * directly. */
export async function testEmbeddingProvider(config: { endpoint: string; model: string; apiKey?: string }): Promise<EmbeddingProviderTestResult> {
  if (!config.endpoint.trim() || !config.model.trim()) {
    return { ok: false, message: 'Both an endpoint and a model are required.' };
  }
  try {
    const provider = new HttpEmbeddingProvider(config);
    const vector = await provider.embedQuery('connection test');
    return { ok: true, message: `Success — received a ${vector.length}-dimensional embedding.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
