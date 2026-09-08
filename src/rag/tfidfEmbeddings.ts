import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings';

/**
 * A local, zero-dependency `Embeddings` implementation — TF-IDF over
 * unigrams AND bigrams, with light stemming and a small hand-curated
 * synonym table for common test-automation/DB/API vocabulary — L2-
 * normalized so cosine similarity reduces to a plain dot product (see
 * flatVectorStore.ts). Deliberately not a neural embedding: for a small,
 * curated, well-tagged internal snippet library (dozens to a few hundred
 * recipes — see ragTypes.ts), this gets most of the practical accuracy
 * benefit of "understanding" near-synonyms and short phrases without a
 * model download, a WASM runtime, a native binary, or any network access
 * — a deliberate choice over a local neural embedding (evaluated and
 * explicitly rejected: the smallest usable model + runtime would have
 * added on the order of 70-100MB to the packaged extension for a gain
 * this synonym/bigram layer covers a meaningful chunk of, at zero size
 * cost and zero new runtime risk).
 *
 * Genuine LangChain integration point: this extends `@langchain/core`'s own
 * `Embeddings` base class (the same package already used for the Verify &
 * Fix agent), so it plugs directly into `flatVectorStore.ts` and any other
 * LangChain-based retrieval code without an adapter layer.
 *
 * Usage: `fit()` once over the WHOLE corpus (this computes the vocabulary
 * and IDF weights), then `embedDocuments()` those same documents and
 * `embedQuery()` any later query text — an out-of-vocabulary term (one
 * `fit()` never saw) simply contributes nothing to the query vector, which
 * is standard, expected TF-IDF behavior, not an error.
 */
export class TfIdfEmbeddings extends Embeddings {
  private vocabulary = new Map<string, number>();
  private idf: number[] = [];
  private fitted = false;

  constructor(params: EmbeddingsParams = {}) {
    super(params);
  }

  /** Lowercase word/identifier tokenizer — splits on anything that isn't a
   * letter, digit, or underscore, and drops single-character tokens (too
   * common/low-signal to matter, e.g. stray "a"/"x" left over from code).
   * Deliberately simple and easy to reason about/test rather than
   * attempting real camelCase/snake_case splitting — the corpus's own
   * title/tags (plain English) carry most of the retrieval signal anyway.
   * This is the RAW split only — see `extractFeatures()` below for the
   * normalized+bigram feature set actually fed into the TF-IDF vectors. */
  static tokenize(text: string): string[] {
    return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((token) => token.length > 1);
  }

  /**
   * Deliberately small and hand-curated, not a general thesaurus — maps a
   * handful of common ABBREVIATIONS/spelling variants of the exact same
   * test-automation/DB/API concept onto one canonical term, so e.g. a
   * recipe tagged "db" and a scenario phrased "database" land on the same
   * term in the vector space instead of two unrelated ones.
   *
   * Every entry merges genuine spelling/abbreviation variants of ONE
   * concept — deliberately never two DIFFERENT concepts. In particular,
   * distinct database/vendor names are never merged into each other
   * (`postgres` canonicalizes toward its own full name "postgresql", never
   * toward "mysql") — conflating two different vendors would actively hurt
   * precision (a MySQL-specific helper wrongly matching a Postgres
   * scenario), not help it.
   */
  private static readonly SYNONYM_CANONICAL: Readonly<Record<string, string>> = {
    // Database
    db: 'database',
    rdbms: 'database',
    postgres: 'postgresql',
    psql: 'postgresql',
    mssql: 'sqlserver',
    conn: 'connection',
    qry: 'query',
    tbl: 'table',
    col: 'column',
    rec: 'record',
    // Auth / security
    auth: 'authentication',
    authn: 'authentication',
    authz: 'authorization',
    creds: 'credential',
    credentials: 'credential',
    pwd: 'password',
    passwd: 'password',
    jwt: 'token',
    bearer: 'token',
    // API / HTTP
    req: 'request',
    resp: 'response',
    uri: 'url',
    endpt: 'endpoint',
    // General
    usr: 'user',
    env: 'environment',
    cfg: 'configuration',
    config: 'configuration'
  };

  /** Minimal, conservative plural stemmer — NOT a general-purpose stemmer
   * (e.g. it never touches verb tenses), just enough to fold "tables" onto
   * "table", "queries" onto "query", "connections" onto "connection", etc.
   * so a corpus author's singular tag still matches a scenario phrased in
   * the plural or vice versa. Guarded by a minimum length so it never
   * mangles a short, already-meaningful word (e.g. "sql", "css", "api"
   * are all left alone; "class"/"status"-style double-s endings are
   * explicitly excluded too). */
  private static destem(token: string): string {
    if (token.length > 4 && token.endsWith('ies')) {
      return `${token.slice(0, -3)}y`;
    }
    if (token.length > 4 && /(?:s|x|ch|sh)es$/.test(token)) {
      return token.slice(0, -2);
    }
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
      return token.slice(0, -1);
    }
    return token;
  }

  private static canonicalize(token: string): string {
    const synonym = TfIdfEmbeddings.SYNONYM_CANONICAL[token];
    // The synonym table takes priority over stemming (checked first) so a
    // short irregular form like "creds" — which generic stemming would
    // otherwise mangle into "cred" — resolves correctly via the explicit
    // dictionary entry instead.
    return synonym ?? TfIdfEmbeddings.destem(token);
  }

  /** The actual feature set fed into TF-IDF: raw tokens (see `tokenize()`),
   * each normalized via the synonym table + light stemming above, PLUS a
   * bigram for every adjacent pair of normalized tokens (e.g. "database"
   * next to "connection" also contributes the phrase feature
   * "database_connection") — a recipe and a scenario that share a two-word
   * phrase verbatim now score meaningfully higher than one that only
   * shares its two words scattered separately, without losing single-word
   * matching for everything else. */
  static extractFeatures(text: string): string[] {
    const unigrams = TfIdfEmbeddings.tokenize(text).map(TfIdfEmbeddings.canonicalize);
    if (unigrams.length < 2) {
      return unigrams;
    }
    const bigrams: string[] = [];
    for (let i = 0; i < unigrams.length - 1; i++) {
      bigrams.push(`${unigrams[i]}_${unigrams[i + 1]}`);
    }
    return unigrams.concat(bigrams);
  }

  get vocabularySize(): number {
    return this.vocabulary.size;
  }

  fit(documents: string[]): void {
    const documentFrequency = new Map<string, number>();
    for (const document of documents) {
      const uniqueTerms = new Set(TfIdfEmbeddings.extractFeatures(document));
      for (const term of uniqueTerms) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    this.vocabulary = new Map();
    this.idf = [];
    const totalDocuments = documents.length;
    let index = 0;
    for (const [term, count] of documentFrequency) {
      this.vocabulary.set(term, index);
      // Smoothed IDF (as scikit-learn's TfidfVectorizer uses by default) —
      // always finite and positive, never divides by zero even for a term
      // that appears in every document.
      this.idf.push(Math.log((1 + totalDocuments) / (1 + count)) + 1);
      index += 1;
    }
    this.fitted = true;
  }

  private vectorize(text: string): number[] {
    if (!this.fitted) {
      throw new Error('TfIdfEmbeddings.fit() must be called with the full corpus before embedding anything.');
    }
    const vector = new Array<number>(this.vocabulary.size).fill(0);
    const features = TfIdfEmbeddings.extractFeatures(text);
    if (features.length === 0) {
      return vector;
    }

    const termCounts = new Map<string, number>();
    for (const term of features) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
    for (const [term, count] of termCounts) {
      const vocabIndex = this.vocabulary.get(term);
      if (vocabIndex === undefined) {
        continue; // out-of-vocabulary — fine, see class doc comment
      }
      const termFrequency = count / features.length;
      vector[vocabIndex] = termFrequency * this.idf[vocabIndex];
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
    return vector;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((document) => this.vectorize(document));
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.vectorize(document);
  }
}
