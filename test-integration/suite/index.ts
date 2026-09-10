import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * Entry point `@vscode/test-electron` requires INSIDE the real Extension
 * Host (see `runTest.ts`'s own `extensionTestsPath`) — must export a
 * `run(): Promise<void>` that resolves on success and rejects (or throws)
 * on any test failure, which is how `@vscode/test-electron` reports a
 * non-zero exit code back to the CLI.
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 30_000 });
  const testsRoot = __dirname;

  const files = await glob('**/*.test.js', { cwd: testsRoot });
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
