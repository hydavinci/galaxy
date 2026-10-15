// Read-only packaging guard. Run before tsc or Vite can emit anything.
import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../dist', import.meta.url);
try {
  const stat = await lstat(output);
  if (stat.isSymbolicLink()) {
    console.error(`Refusing build: ${fileURLToPath(output)} is a symlink. Build in a clean checkout or isolated export; never overwrite a live release.`);
    process.exitCode = 1;
  } else if (!stat.isDirectory()) {
    console.error(`Refusing build: ${fileURLToPath(output)} exists but is not a directory.`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
