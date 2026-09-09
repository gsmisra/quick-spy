import * as vscode from 'vscode';
import { parseRagFile } from './ragFrontmatter';
import { RagRecipe } from './ragTypes';
import { buildRagIndex, RagIndex } from './ragIndexBuilder';

export type { RagIndex } from './ragIndexBuilder';

/**
 * The vscode-aware half of RAG indexing — finds every `.md` file under
 * `.github/rag/`, recursively (a project/framework zip dropped on
 * "Generate RAG Corpus format" preserves its own folder structure there —
 * see ragCorpusGenerator.ts, zipReader.ts — so retrieval has to walk every
 * subfolder too, not just the top level), parses each one
 * (ragFrontmatter.ts), and hands the result to ragIndexBuilder.ts's pure
 * `buildRagIndex()`. Uses `vscode.workspace.findFiles` (glob-based, so
 * recursion is a one-line pattern rather than a hand-rolled directory walk)
 * so this keeps working in virtual/remote workspaces, not just a local disk
 * checkout.
 *
 * Cached in-memory, invalidated by a fingerprint of every recipe file's
 * path + mtime + size — the same "re-read only when something actually
 * changed" idea as cache/fileCache.ts, just fingerprinting a whole
 * directory tree's listing instead of one file. A missing `.github/rag`
 * folder, or one with no valid `.md` recipes anywhere under it, resolves to
 * `undefined` — always treated as "retrieval has nothing to offer right
 * now," never as an error a user needs to fix before generating code.
 */

const RAG_FOLDER_SEGMENTS = ['.github', 'rag'];

export function ragFolderUri(workspaceRoot: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, ...RAG_FOLDER_SEGMENTS);
}

interface CachedIndex {
  fingerprint: string;
  index: RagIndex;
}

let cached: CachedIndex | undefined;

async function computeFingerprint(uris: vscode.Uri[]): Promise<string> {
  const stats = await Promise.all(
    uris.map(async (uri) => {
      const stat = await vscode.workspace.fs.stat(uri);
      return `${uri.fsPath}:${stat.mtime}:${stat.size}`;
    })
  );
  return stats.sort().join('|');
}

/** Builds (or reuses a cached) RAG index for `workspaceRoot`. `undefined`
 * means "nothing to retrieve" (no folder, or no valid recipes in it) —
 * never throws for that. `onWarn`, if given, is called once per recipe
 * file that exists but fails to parse (e.g. malformed frontmatter from a
 * hand-edited file), so the caller can surface it (Output channel) without
 * this function needing to know how. */
export async function getOrBuildRagIndex(workspaceRoot: vscode.Uri, onWarn?: (message: string) => void): Promise<RagIndex | undefined> {
  const folder = ragFolderUri(workspaceRoot);
  let mdFiles: vscode.Uri[];
  try {
    mdFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.md'));
  } catch {
    return undefined;
  }

  if (mdFiles.length === 0) {
    cached = undefined;
    return undefined;
  }

  const fingerprint = await computeFingerprint(mdFiles);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.index;
  }

  const recipes: RagRecipe[] = [];
  for (const uri of mdFiles) {
    let content: string;
    let mtimeMs: number;
    try {
      const [bytes, stat] = await Promise.all([vscode.workspace.fs.readFile(uri), vscode.workspace.fs.stat(uri)]);
      content = new TextDecoder('utf-8').decode(bytes);
      mtimeMs = stat.mtime;
    } catch (err) {
      onWarn?.(`Could not read ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const parsed = parseRagFile(content);
    if (!parsed.ok) {
      onWarn?.(`Skipping ${uri.fsPath} — ${parsed.error}`);
      continue;
    }
    recipes.push({ filePath: uri.fsPath, frontmatter: parsed.value.frontmatter, body: parsed.value.body, mtimeMs });
  }

  if (recipes.length === 0) {
    cached = undefined;
    return undefined;
  }

  const index = await buildRagIndex(recipes);
  cached = { fingerprint, index };
  return index;
}

/** Forces the next `getOrBuildRagIndex()` call to rebuild from disk
 * regardless of the fingerprint — not currently wired to a command,
 * exposed for tests and a future explicit "rebuild index" affordance. Also
 * called automatically right after the RAG corpus generator writes new
 * files (see ragCorpusGenerator.ts) so the very next code generation
 * already sees them, without waiting for a fingerprint recheck. */
export function clearRagIndexCache(): void {
  cached = undefined;
}
