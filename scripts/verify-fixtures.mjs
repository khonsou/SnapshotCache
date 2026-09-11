import { readFile } from 'node:fs/promises';
import { readPackage } from '../src/snapshot/files.mjs';
import { validatePackage } from '../src/snapshot/validate.mjs';
const catalog = JSON.parse(await readFile('examples/snapshots/catalog.json'));
const parents = new Map(catalog.entries.map(e => [e.ref.snapshotId, { scope: e.scope }]));
for (const entry of catalog.entries) {
  const pkg = await readPackage('examples/snapshots/' + entry.ref.snapshotId);
  await validatePackage(pkg.manifest, pkg.files, entry.ref, entry.scope, parents);
}
console.log(`Verified ${catalog.entries.length} packages: schema, scope, references, bytes, hashes and web runtime profile.`);
