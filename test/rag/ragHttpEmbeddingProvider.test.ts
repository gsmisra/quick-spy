import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildEmbeddingRequestBody, parseEmbeddingResponse, HttpEmbeddingProvider, EmbeddingTimeoutError } from '../../src/rag/ragHttpEmbeddingProvider';

// --- buildEmbeddingRequestBody (pure) ---------------------------------------

test('buildEmbeddingRequestBody produces the OpenAI-compatible {model, input} shape', () => {
  assert.deepEqual(buildEmbeddingRequestBody('text-embedding-3-small', ['a', 'b']), { model: 'text-embedding-3-small', input: ['a', 'b'] });
});

// --- parseEmbeddingResponse (pure) ------------------------------------------

test('parseEmbeddingResponse extracts vectors in plain response order when no "index" field is present', () => {
  const raw = { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] };
  assert.deepEqual(parseEmbeddingResponse(raw, 2), [
    [1, 2],
    [3, 4]
  ]);
});

test('parseEmbeddingResponse re-sorts by the "index" field when the provider returns entries out of order', () => {
  const raw = { data: [{ embedding: [9, 9], index: 1 }, { embedding: [1, 1], index: 0 }] };
  assert.deepEqual(parseEmbeddingResponse(raw, 2), [
    [1, 1],
    [9, 9]
  ]);
});

test('parseEmbeddingResponse throws for a response missing a "data" array entirely', () => {
  assert.throws(() => parseEmbeddingResponse({ notData: [] }, 1), /Unexpected embedding response shape/);
  assert.throws(() => parseEmbeddingResponse(null, 1), /Unexpected embedding response shape/);
  assert.throws(() => parseEmbeddingResponse('a string', 1), /Unexpected embedding response shape/);
});

test('parseEmbeddingResponse throws when the vector count does not match what was requested', () => {
  const raw = { data: [{ embedding: [1] }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /returned 1 vector\(s\), expected 2/);
});

test('parseEmbeddingResponse throws for an entry with a non-array "embedding"', () => {
  const raw = { data: [{ embedding: 'not-an-array' }] };
  assert.throws(() => parseEmbeddingResponse(raw, 1), /missing a valid numeric "embedding" array/);
});

test('parseEmbeddingResponse throws for an entry with a non-numeric value inside "embedding"', () => {
  const raw = { data: [{ embedding: [1, 'nope', 3] }] };
  assert.throws(() => parseEmbeddingResponse(raw, 1), /missing a valid numeric "embedding" array/);
});

test('parseEmbeddingResponse throws for an empty "embedding" array', () => {
  const raw = { data: [{ embedding: [] }] };
  assert.throws(() => parseEmbeddingResponse(raw, 1), /missing a valid numeric "embedding" array/);
});

test('parseEmbeddingResponse rejects a non-finite value (NaN/Infinity) inside "embedding"', () => {
  const raw = { data: [{ embedding: [1, NaN, 3] }] };
  assert.throws(() => parseEmbeddingResponse(raw, 1), /missing a valid numeric "embedding" array/);
});

// --- A11: index bijection + cross-batch dimension consistency ---------------

test('A11: parseEmbeddingResponse throws when TWO entries claim the SAME "index" — never silently corresponds a vector to the wrong input', () => {
  const raw = { data: [{ embedding: [1, 1], index: 0 }, { embedding: [2, 2], index: 0 }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /more than one entry claiming "index" 0/);
});

test('A11: parseEmbeddingResponse throws when an "index" is OUT OF RANGE for the expected count — the RIGHT total count alone is not enough to trust', () => {
  const raw = { data: [{ embedding: [1, 1], index: 0 }, { embedding: [2, 2], index: 99 }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /out-of-range "index" \(99\)/);
});

test('A11: parseEmbeddingResponse throws for a NEGATIVE "index"', () => {
  const raw = { data: [{ embedding: [1, 1], index: -1 }, { embedding: [2, 2], index: 0 }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /out-of-range "index" \(-1\)/);
});

test('A11: parseEmbeddingResponse throws for a non-integer "index"', () => {
  const raw = { data: [{ embedding: [1, 1], index: 0.5 }, { embedding: [2, 2], index: 1 }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /out-of-range "index" \(0\.5\)/);
});

test('A11: a misindexed batch that still has the RIGHT count but a garbled index set is refused, not silently misordered (the exact reproduced gap)', () => {
  // The right NUMBER of entries (2), but indices 0 and 0 — never a valid
  // correspondence to a 2-input batch. Before this fix, this "succeeded"
  // by sorting on index (a stable no-op for a tie) and mapping by sorted
  // POSITION, silently accepting a garbled index set with no error.
  const raw = { data: [{ embedding: [1, 1], index: 0 }, { embedding: [9, 9], index: 0 }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2));
});

test('A11: parseEmbeddingResponse throws when vectors within the SAME batch have DIFFERENT dimensions', () => {
  const raw = { data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5] }] };
  assert.throws(() => parseEmbeddingResponse(raw, 2), /mixes vectors of different dimensions \(3 vs 2\)/);
});

test('A11: parseEmbeddingResponse accepts a well-formed batch with EXPLICIT indices covering the full range exactly once', () => {
  const raw = { data: [{ embedding: [1, 1], index: 1 }, { embedding: [0, 0], index: 0 }] };
  assert.deepEqual(parseEmbeddingResponse(raw, 2), [
    [0, 0],
    [1, 1]
  ]);
});

// --- HttpEmbeddingProvider (mocked fetch — network call itself, reviewed rather than exhaustively tested) ---

function withMockedFetch<T>(mock: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('HttpEmbeddingProvider.embedDocuments sends model+input and an Authorization header when an apiKey is configured', async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: string | undefined;
  const mockFetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 });
  }) as typeof fetch;

  await withMockedFetch(mockFetch, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'my-model', apiKey: 'secret-key' });
    const result = await provider.embedDocuments(['hello']);
    assert.deepEqual(result, [[1, 2, 3]]);
  });

  assert.equal(capturedUrl, 'https://example.test/embed');
  assert.equal(capturedInit?.method, 'POST');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(capturedInit!.body as string), { model: 'my-model', input: ['hello'] });
});

test('HttpEmbeddingProvider.embedDocuments omits the Authorization header entirely when no apiKey is configured', async () => {
  let capturedInit: RequestInit | undefined;
  const mockFetch = (async () => {
    return new Response(JSON.stringify({ data: [{ embedding: [1] }] }), { status: 200 });
  }) as typeof fetch;
  const mockFetchCapturing = (async (url: string, init?: RequestInit) => {
    capturedInit = init;
    return mockFetch(url, init);
  }) as typeof fetch;

  await withMockedFetch(mockFetchCapturing, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'my-model' });
    await provider.embedDocuments(['hello']);
  });

  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
});

test('HttpEmbeddingProvider.embedDocuments throws a readable error on a non-ok HTTP response', async () => {
  const mockFetch = (async () => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })) as typeof fetch;
  await withMockedFetch(mockFetch, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm' });
    await assert.rejects(() => provider.embedDocuments(['x']), /429/);
  });
});

test('HttpEmbeddingProvider.embedDocuments on an empty text array never calls fetch at all', async () => {
  let called = false;
  const mockFetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await withMockedFetch(mockFetch, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm' });
    const result = await provider.embedDocuments([]);
    assert.deepEqual(result, []);
  });
  assert.equal(called, false);
});

test('HttpEmbeddingProvider.embedQuery embeds a single-element batch and returns its one vector', async () => {
  const mockFetch = (async () => new Response(JSON.stringify({ data: [{ embedding: [4, 5] }] }), { status: 200 })) as typeof fetch;
  await withMockedFetch(mockFetch, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm' });
    const vector = await provider.embedQuery('a query');
    assert.deepEqual(vector, [4, 5]);
  });
});

test('HttpEmbeddingProvider.id uniquely identifies the (endpoint, model) pair', () => {
  const a = new HttpEmbeddingProvider({ endpoint: 'https://x/embed', model: 'm1' });
  const b = new HttpEmbeddingProvider({ endpoint: 'https://x/embed', model: 'm2' });
  const c = new HttpEmbeddingProvider({ endpoint: 'https://y/embed', model: 'm1' });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

// --- A10: bounded timeout + cancellation ------------------------------------

/** A mock `fetch` that faithfully emulates a REAL stalled/unresponsive
 * endpoint: never resolves or rejects on its own, but DOES honor
 * `init.signal` exactly like a real `fetch()` would — rejecting with an
 * AbortError the moment the signal aborts (whether that's this test's own
 * cancellation `AbortController`, or ragHttpEmbeddingProvider.ts's internal
 * bounded-timeout controller). Without a mock this faithful, a test
 * exercising the timeout/cancellation path would either need a REAL 30s+
 * wait or wouldn't actually prove `fetch()` is ever really aborted at all. */
function stalledFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort);
    });
  }) as typeof fetch;
}

test('A10: HttpEmbeddingProvider.embedDocuments throws a distinct EmbeddingTimeoutError when the request stalls past its OWN bounded timeout', async () => {
  await withMockedFetch(stalledFetch(), async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm', timeoutMs: 20 });
    await assert.rejects(() => provider.embedDocuments(['x']), (err: unknown) => {
      assert.ok(err instanceof EmbeddingTimeoutError, `expected an EmbeddingTimeoutError, got ${err}`);
      assert.match((err as Error).message, /timed out after 20ms/);
      return true;
    });
  });
});

test('A10: HttpEmbeddingProvider.embedDocuments respects a CALLER-supplied signal — aborting it rejects the request immediately, distinct from a timeout', async () => {
  await withMockedFetch(stalledFetch(), async () => {
    // A generous timeout that would NEVER fire during this test — proves
    // the rejection came from the caller's own signal, not the internal
    // timeout racing it.
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm', timeoutMs: 60_000 });
    const controller = new AbortController();
    const promise = provider.embedDocuments(['x'], controller.signal);
    controller.abort();
    await assert.rejects(() => promise, (err: unknown) => {
      assert.ok(!(err instanceof EmbeddingTimeoutError), 'caller cancellation must NOT be reported as a timeout');
      assert.equal((err as Error).name, 'AbortError');
      return true;
    });
  });
});

test('A10: HttpEmbeddingProvider.embedDocuments treats an ALREADY-aborted caller signal the same way — rejects immediately, never even waiting on the timeout', async () => {
  await withMockedFetch(stalledFetch(), async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm', timeoutMs: 60_000 });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => provider.embedDocuments(['x'], controller.signal), (err: unknown) => {
      assert.ok(!(err instanceof EmbeddingTimeoutError));
      return true;
    });
  });
});

test('A10: a malformed response is reported as the ORIGINAL parse error, never mislabeled as a timeout', async () => {
  const mockFetch = (async () => new Response('not json at all', { status: 200 })) as typeof fetch;
  await withMockedFetch(mockFetch, async () => {
    const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm', timeoutMs: 60_000 });
    await assert.rejects(() => provider.embedDocuments(['x']), (err: unknown) => {
      assert.ok(!(err instanceof EmbeddingTimeoutError));
      return true;
    });
  });
});

test('A10: a subsequent call succeeds normally after a prior timeout — the internal timer/listener never leaks or corrupts a later request', async () => {
  const provider = new HttpEmbeddingProvider({ endpoint: 'https://example.test/embed', model: 'm', timeoutMs: 20 });
  await withMockedFetch(stalledFetch(), async () => {
    await assert.rejects(() => provider.embedDocuments(['x']), EmbeddingTimeoutError);
  });
  const okFetch = (async () => new Response(JSON.stringify({ data: [{ embedding: [7, 8] }] }), { status: 200 })) as typeof fetch;
  await withMockedFetch(okFetch, async () => {
    const result = await provider.embedDocuments(['x']);
    assert.deepEqual(result, [[7, 8]]);
  });
});
