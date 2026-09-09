import * as path from 'path';

/**
 * Pure filtering rules for "Generate RAG Corpus format" when the upload is
 * an entire project/framework zip (see zipReader.ts, ragCorpusGenerator.ts)
 * rather than a handful of individually-dropped files — a real project zip
 * drags in plenty of noise (build output, dependency caches, VCS metadata,
 * binaries) that would either waste an LLM call generating a useless
 * recipe or outright fail to decode as text. Zero `vscode` import so this
 * is directly unit-testable.
 */

/** Same extensions the file-picker's own `accept` attribute offers for a
 * direct drop (settingsPanel.ts) — kept as a single source of truth here so
 * a zip's contents are filtered by the exact same rule as a manually
 * chosen file. */
export const SUPPORTED_RAG_UPLOAD_EXTENSIONS = new Set([
  '.java', '.py', '.js', '.ts', '.jsx', '.tsx', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.json', '.xml', '.yml', '.yaml', '.properties', '.ini', '.toml', '.sql', '.scala', '.kt', '.kts',
  '.rb', '.go', '.cs', '.gradle', '.groovy', '.conf', '.cfg', '.md', '.txt'
]);

export function isSupportedRagSourceFile(fileName: string): boolean {
  return SUPPORTED_RAG_UPLOAD_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Directory names that are never worth generating a recipe from —
 * dependency caches, build output, VCS/IDE metadata — regardless of what
 * language a project zip is otherwise written in. Matched against any path
 * segment, case-insensitively, so `target/classes/...` or
 * `frontend/node_modules/...` are excluded no matter how deep. */
const NOISE_DIRECTORY_NAMES = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'target', 'build', 'dist', 'out',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.vs', 'bin', 'obj',
  '.gradle', '.mvn', 'coverage', '.pytest_cache', '.settings', '.tox', 'vendor'
]);

export function isNoiseDirectoryPath(relativePath: string): boolean {
  if (!relativePath) {
    return false;
  }
  return relativePath
    .split(/[\\/]+/)
    .some((segment) => NOISE_DIRECTORY_NAMES.has(segment.toLowerCase()));
}
