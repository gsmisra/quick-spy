import { Document } from '@langchain/core/documents';
import { TfIdfEmbeddings } from './tfidfEmbeddings';
import { LocalFlatVectorStore } from './flatVectorStore';
import { RagRecipe, recipeToEmbeddingText } from './ragTypes';

/**
 * The pure half of RAG indexing — given already-parsed recipes (see
 * ragTypes.ts), fits the TF-IDF embedder and builds the flat vector store.
 * Zero `vscode` import, so it's directly unit-testable with hand-built
 * `RagRecipe` fixtures — the actual "does retrieval rank the right recipe
 * highest" logic lives and is tested here, not in the vscode-dependent
 * directory-reading glue (ragIndexer.ts), matching the same split already
 * used for the Verify & Fix agent (agent/verifyFixAgent.ts vs.
 * agent/verifyFixOrchestrator.ts).
 */
export interface RagIndex {
  store: LocalFlatVectorStore;
  embeddings: TfIdfEmbeddings;
  recipes: RagRecipe[];
}

export interface RagRecipeMetadata extends Record<string, unknown> {
  id: string;
  title: string;
  automationMode: string[];
  language: string[];
  imports?: { java?: string[]; python?: string[] };
  recipeIndex: number;
  /** The recipe's own source file path (see RagRecipe.filePath) — carried
   * through the vector store into every RagMatch so a caller can point a
   * user at EXACTLY which `.github/rag/*.md` file a piece of generated
   * code was traced back to (see ragRetriever.ts's RagMatch and
   * objectSpyPanel.ts's RAG traceability banner). */
  filePath: string;
}

export async function buildRagIndex(recipes: RagRecipe[]): Promise<RagIndex> {
  const embeddings = new TfIdfEmbeddings();
  const texts = recipes.map(recipeToEmbeddingText);
  embeddings.fit(texts);
  const vectors = await embeddings.embedDocuments(texts);

  const documents = recipes.map((recipe, index) => {
    const metadata: RagRecipeMetadata = {
      id: recipe.frontmatter.id,
      title: recipe.frontmatter.title,
      automationMode: recipe.frontmatter.automationMode,
      language: recipe.frontmatter.language,
      imports: recipe.frontmatter.imports,
      recipeIndex: index,
      filePath: recipe.filePath
    };
    return new Document({ pageContent: recipe.body, metadata });
  });

  const store = new LocalFlatVectorStore(embeddings);
  await store.reset(vectors, documents);

  return { store, embeddings, recipes };
}
