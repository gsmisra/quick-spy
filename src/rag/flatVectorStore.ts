import { VectorStore } from '@langchain/core/vectorstores';
import { Document, type DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';

/**
 * A local, in-memory, brute-force vector store — the "no external vector
 * DB, no FAISS" answer for a corpus this small. FAISS (and every real
 * vector DB) exists to make approximate nearest-neighbor search fast over
 * millions of vectors; this extension's reusable-component corpus (see
 * ragTypes.ts) is realistically dozens to a few hundred entries, at which
 * scale a plain linear scan computing an exact dot product against every
 * vector is sub-millisecond — no index structure, no native binary, no
 * server process to manage. Genuinely simpler AND correct (exact nearest
 * neighbor, not approximate) at this scale.
 *
 * Extends `@langchain/core`'s own `VectorStore` base class — the same
 * package already used for the Verify & Fix agent — so this plugs into any
 * LangChain-based retrieval code (`.similaritySearch()`,
 * `.asRetriever()`, ...) with zero adapter layer.
 *
 * Vectors are expected to already be L2-normalized (TfIdfEmbeddings does
 * this) so similarity is a plain dot product; this store doesn't
 * normalize on its own, to avoid silently masking a caller bug that
 * produces unnormalized vectors.
 */
export class LocalFlatVectorStore extends VectorStore {
  declare FilterType: Record<string, unknown>;

  private vectors: number[][] = [];
  private documents: DocumentInterface[] = [];

  constructor(embeddings: EmbeddingsInterface) {
    super(embeddings, {});
  }

  _vectorstoreType(): string {
    return 'softplay-local-flat';
  }

  get size(): number {
    return this.documents.length;
  }

  async addVectors(vectors: number[][], documents: DocumentInterface[]): Promise<void> {
    if (vectors.length !== documents.length) {
      throw new Error(`addVectors(): got ${vectors.length} vectors but ${documents.length} documents.`);
    }
    for (let i = 0; i < vectors.length; i++) {
      this.vectors.push(vectors[i]);
      this.documents.push(documents[i]);
    }
  }

  async addDocuments(documents: DocumentInterface[]): Promise<void> {
    const texts = documents.map((doc) => doc.pageContent);
    const vectors = await this.embeddings.embedDocuments(texts);
    await this.addVectors(vectors, documents);
  }

  /** Replaces the entire store's contents — used by ragIndexer.ts on every
   * (re)build rather than incrementally adding, since a corpus rebuild
   * always starts from the current set of `.github/rag/*.md` files on
   * disk, never from whatever happened to be indexed before. */
  async reset(vectors: number[][], documents: DocumentInterface[]): Promise<void> {
    this.vectors = [];
    this.documents = [];
    await this.addVectors(vectors, documents);
  }

  private static dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private matchesFilter(metadata: Record<string, unknown>, filter?: this['FilterType']): boolean {
    if (!filter) {
      return true;
    }
    for (const [key, expected] of Object.entries(filter)) {
      const actual = metadata[key];
      // A metadata field that's an array (e.g. automationMode: ['ui','api'])
      // matches if the expected value is one of its entries; a scalar field
      // matches on strict equality. Covers exactly the two shapes
      // ragIndexer.ts's document metadata actually uses.
      const isMatch = Array.isArray(actual) ? actual.includes(expected) : actual === expected;
      if (!isMatch) {
        return false;
      }
    }
    return true;
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: this['FilterType']
  ): Promise<[DocumentInterface, number][]> {
    const scored: [DocumentInterface, number][] = [];
    for (let i = 0; i < this.documents.length; i++) {
      if (!this.matchesFilter(this.documents[i].metadata, filter)) {
        continue;
      }
      scored.push([this.documents[i], LocalFlatVectorStore.dotProduct(query, this.vectors[i])]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, k);
  }

  /** Convenience factory matching the shape of LangChain's own
   * `VectorStore.fromDocuments()` static constructors, for symmetry with
   * the rest of the ecosystem — not currently used by ragIndexer.ts, which
   * builds the store directly since it needs the fitted embeddings
   * instance back too, but kept as the obvious, discoverable entry point. */
  static async fromDocuments(documents: Document[], embeddings: EmbeddingsInterface): Promise<LocalFlatVectorStore> {
    const store = new LocalFlatVectorStore(embeddings);
    await store.addDocuments(documents);
    return store;
  }
}
