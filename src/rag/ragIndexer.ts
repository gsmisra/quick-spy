import * as vscode from 'vscode';
import { parseRagFile } from './ragFrontmatter';
import { RagRecipe } from './ragTypes';
import { buildRagIndex, RagIndex } from './ragIndexBuilder';

export type { RagIndex } from './ragIndexBuilder';

/**
 * The vscode-aware half of RAG indexing — finds `.github/rag/*.md`,
 * parses each one (ragFrontmatter.ts), and hands the result to
 * ragIndexBuilder.ts's pure `buildRagIndex()`. Uses `vscode.workspace.fs`
 * rather than plain `fs` (matching cache/fileCache.ts's
 * `readWorkspaceFileCached()`) so this keeps working in virtual/remote
 * workspaces, not just a local disk checkout.
 *
 * Cached in-memory, invalidated by a fingerprint of every recipe file's
 * name + mtime + size — the same "re-read only when something actually
 * changed" idea as cache/fileCache.ts, just fingerprinting a whole
 * directory's listing instead of one file. A missing `.github/rag` folder,
 * or one with no valid `.md` recipes, resolves to `undefined` — always
 * treated as "retrieval has nothing to offer right now," never as an
 * error a user needs to fix before generating code.
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

async function computeFingerprint(folder: vscode.Uri, mdFileNames: string[]): Promise<string> {
  const stats = await Promise.all(
    mdFileNames.map(async (name) => {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name));
      return `${name}:${stat.mtime}:${stat.size}`;
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
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return undefined;
  }

  const mdFileNames = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.md'))
    .map(([name]) => name);
  if (mdFileNames.length === 0) {
    cached = undefined;
    return undefined;
  }

  const fingerprint = await computeFingerprint(folder, mdFileNames);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.index;
  }

  const recipes: RagRecipe[] = [];
  for (const name of mdFileNames) {
    const uri = vscode.Uri.joinPath(folder, name);
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
