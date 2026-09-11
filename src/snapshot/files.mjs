import { readdir, lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safePath, LIMITS, validatePackage } from './validate.mjs';

export async function readPackage(root) {
  const files = new Map();
  let total = 0;
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Not a package directory');
  async function visit(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const path = prefix + name;
      if (!safePath(path)) throw new Error('Unsafe file path');
      const stat = await lstat(join(dir, name));
      if (stat.isSymbolicLink()) throw new Error('Symlink not allowed');
      if (stat.isDirectory()) { await visit(join(dir, name), path + '/'); continue; }
      if (!stat.isFile() || files.size >= LIMITS.files + 1 || stat.size > LIMITS.fileBytes) throw new Error('File limit exceeded');
      total += stat.size;
      if (total > LIMITS.totalBytes + LIMITS.manifestBytes) throw new Error('Package limit exceeded');
      files.set(path, new Uint8Array(await readFile(join(dir, name))));
    }
  }
  await visit(root);
  const manifest = files.get('manifest.json');
  if (!manifest) throw new Error('Manifest missing');
  files.delete('manifest.json');
  return { manifest, files };
}

// Existing IDs may only be verified as byte-identical. Never overwrite committed fixtures.
export async function commitFixture(root, bytes, files, expected, scope, parents) {
  await validatePackage(bytes, files, expected, scope, parents);
  try {
    const existing = await readPackage(root);
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
    if (!same(existing.manifest, bytes) || existing.files.size !== files.size || [...files].some(([p, b]) => !same(existing.files.get(p), b))) throw new Error('Immutable snapshot ID conflict; use a new snapshotId');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Local fixture authoring only. A partial interrupted write fails verification on the next run.
  await mkdir(root, { recursive: true });
  for (const [path, body] of files) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, body, { flag: 'wx' });
  }
  await writeFile(join(root, 'manifest.json'), bytes, { flag: 'wx' });
}
