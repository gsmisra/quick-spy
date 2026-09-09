import * as vscode from 'vscode';
import * as path from 'path';
import { sendPrompt, CopilotUnavailableError } from '../llm/copilotClient';
import { readFileCachedSync } from '../cache/fileCache';
import { normalizeGeneratedRecipe, ragTargetRelPath } from './ragRecipeNormalizer';

/**
 * "Generate RAG Corpus format" (Settings) — turns an arbitrary uploaded
 * source/config file into a well-structured `.github/rag/<name>.md` recipe
 * via Copilot, so a team can point this at their existing helper classes
 * instead of hand-writing recipe files from scratch. Analyzing arbitrary
 * code to infer a title/tags/target-language/import statement is exactly
 * the kind of judgment call that needs an LLM — a template alone can't do
 * it — so this is the one place in the RAG feature that calls Copilot
 * rather than running fully offline.
 *
 * Vscode-dependent glue (file writing, model resolution) — reviewed rather
 * than unit tested directly, same as llm/copilotClient.ts and
 * agent/vscodeCopilotToolCallingModel.ts; the response post-processing
 * (fence-stripping, schema validation, fallback recovery) is pulled out as
 * the pure, tested `normalizeGeneratedRecipe()` below.
 */

export interface UploadedFile {
  fileName: string;
  content: string;
  /** Folder path this file lived at inside an uploaded project/framework
   * zip (see zipReader.ts) — empty/undefined for a directly dropped single
   * file. Used to mirror the original directory structure under
   * `.github/rag/` (see `ragTargetRelPath()` in ragRecipeNormalizer.ts). */
  relativePath?: string;
}

export interface GenerationProgress {
  fileName: string;
  status: 'started' | 'success' | 'skipped' | 'error';
  message?: string;
}

const RAG_FOLDER_SEGMENTS = ['.github', 'rag'];

function readGenerateRecipeInstructions(): string {
  return readFileCachedSync(path.join(__dirname, '..', '..', 'prompts', 'generate-rag-recipe.md'));
}

export interface GenerateRagCorpusOptions {
  modelId: string;
  files: UploadedFile[];
  workspaceRoot: vscode.Uri;
  cancellationToken: vscode.CancellationToken;
  onProgress: (progress: GenerationProgress) => void;
  /** Called once, before any generation starts, for every file whose
   * target `.md` already exists — return `true` to overwrite ALL of them,
   * `false` to skip ALL of them (generation still proceeds for every other
   * file). Lets the caller show one confirmation dialog instead of one per
   * file. */
  confirmOverwrite: (existingFileNames: string[]) => Promise<boolean>;
}

export async function generateRagCorpus(options: GenerateRagCorpusOptions): Promise<{ succeeded: number; skipped: number; failed: number }> {
  const { modelId, files, workspaceRoot, cancellationToken, onProgress, confirmOverwrite } = options;
  const ragFolder = vscode.Uri.joinPath(workspaceRoot, ...RAG_FOLDER_SEGMENTS);
  await vscode.workspace.fs.createDirectory(ragFolder);

  const instructions = readGenerateRecipeInstructions();
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  // One batch-level overwrite confirmation rather than one dialog per file.
  // Each target is a full relative path (e.g. "src/db/postgres-helper.md")
  // so two same-named files from different zip folders never collide.
  const targets = files.map((f) => ragTargetRelPath(f.fileName, f.relativePath));
  const existing = new Set<string>();
  for (const targetName of new Set(targets)) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(ragFolder, targetName));
      existing.add(targetName);
    } catch {
      // Doesn't exist yet — nothing to confirm for this one.
    }
  }
  const overwriteApproved = existing.size === 0 ? true : await confirmOverwrite(Array.from(existing));

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const targetName = targets[i];
    if (cancellationToken.isCancellationRequested) {
      onProgress({ fileName: file.fileName, status: 'skipped', message: 'Cancelled.' });
      skipped += 1;
      continue;
    }
    if (existing.has(targetName) && !overwriteApproved) {
      onProgress({ fileName: file.fileName, status: 'skipped', message: `${targetName} already exists — not overwritten.` });
      skipped += 1;
      continue;
    }

    onProgress({ fileName: file.fileName, status: 'started' });
    try {
      const prompt = `${instructions}\n\n### Filename\n${file.fileName}\n\n### File content\n\`\`\`\n${file.content}\n\`\`\``;
      let response = '';
      await sendPrompt(modelId, prompt, (chunk) => (response += chunk), cancellationToken);

      const { content, usedFallback, fallbackReason } = normalizeGeneratedRecipe(file.fileName, response);
      const targetSegments = targetName.split('/');
      if (targetSegments.length > 1) {
        // Recreate the original folder structure (e.g. "src/db") before
        // writing — vscode.workspace.fs.createDirectory creates any
        // missing intermediate directories too, like `mkdir -p`.
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(ragFolder, ...targetSegments.slice(0, -1)));
      }
      const targetUri = vscode.Uri.joinPath(ragFolder, ...targetSegments);
      await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));

      succeeded += 1;
      onProgress({
        fileName: file.fileName,
        status: 'success',
        message: usedFallback
          ? `Saved as ${targetName} — the model's output needed a fallback wrapper (${fallbackReason}); please review it.`
          : `Saved as ${targetName}.`
      });
    } catch (err) {
      failed += 1;
      const message = err instanceof CopilotUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      onProgress({ fileName: file.fileName, status: 'error', message });
    }
  }

  return { succeeded, skipped, failed };
}
