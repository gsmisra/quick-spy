import { EmbeddingProvider } from '../ragEmbeddingProvider';

/**
 * A deterministic, ZERO-network, ZERO-model "embedding" provider used ONLY
 * by rag/benchmark/ragHybridEvaluationRunner.ts's evaluation harness when
 * no real semantic embedding provider has been configured for a run.
 *
 * ⚠ THIS IS NOT A SEMANTIC EMBEDDING. It has no notion of meaning,
 * synonymy, or context — it is a character-trigram feature-hashing vector
 * (the classic "hashing trick": every overlapping N-character substring of
 * the (lowercased, whitespace-normalized) text is hashed into one of a
 * fixed number of buckets, counted, and L2-normalized). Its only purpose
 * is to exercise the REAL hybrid-retrieval/RRF-fusion CODE PATH end-to-end
 * against the real benchmark corpus when no real semantic provider is
 * available — proving the mechanism (provider interface, caching, fusion,
 * gating) actually works correctly on real data, NOT that semantic
 * embeddings improve real-world retrieval accuracy. Any accuracy
 * difference this stand-in produces versus lexical-only retrieval reflects
 * character-level surface similarity, not semantic understanding, and must
 * NEVER be cited as evidence about a real semantic provider's quality —
 * see `ragHybridEvaluationRunner.ts`'s own report, which labels every
 * result produced with this provider accordingly.
 *
 * Pure, deterministic, directly unit-tested.
 */

const DEFAULT_DIMENSIONS = 256;
const DEFAULT_NGRAM_SIZE = 3;

/** FNV-1a — a small, well-known, non-cryptographic hash, chosen only for
 * speed and a reasonably even bucket distribution; nothing about this
 * needs to be cryptographically secure. */
function fnv1aHash(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class CharNgramStandInProvider implements EmbeddingProvider {
  readonly id: string;

  constructor(private readonly ngramSize = DEFAULT_NGRAM_SIZE, private readonly dimensions = DEFAULT_DIMENSIONS) {
    this.id = `char-ngram-stand-in-v1:n${ngramSize}:d${dimensions}`;
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
      return vector;
    }
    if (normalized.length < this.ngramSize) {
      vector[fnv1aHash(normalized) % this.dimensions] += 1;
    } else {
      for (let i = 0; i <= normalized.length - this.ngramSize; i++) {
        const gram = normalized.slice(i, i + this.ngramSize);
        vector[fnv1aHash(gram) % this.dimensions] += 1;
      }
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
    return vector;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }
}
