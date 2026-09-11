import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { build } from 'esbuild';
import { readPackage } from '../src/snapshot/files.mjs';
import { validatePackage } from '../src/snapshot/validate.mjs';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
for (const name of ['index.html', 'style.css', 'project-directory.js', 'project-members.js']) await cp('src/web/' + name, 'dist/' + name);
await build({ entryPoints: ['src/web/app.js'], outfile: 'dist/app.js', bundle: true, format: 'iife', target: ['es2022'], minify: true, legalComments: 'eof' });
const assets = Object.create(null);
for (const [name, type] of [['index.html', 'text/html'], ['style.css', 'text/css'], ['app.js', 'text/javascript'], ['project-directory.js', 'text/javascript'], ['project-members.js', 'text/javascript']]) assets['/' + name] = { body: (await readFile('dist/' + name)).toString('base64'), type: type + '; charset=utf-8' };
assets['/'] = assets['/index.html'];
const catalog = JSON.parse(await readFile('examples/snapshots/catalog.json'));
const parents = new Map(catalog.entries.map(e => [e.ref.snapshotId, { scope: e.scope }]));
for (const entry of catalog.entries) {
  const pkg = await readPackage('examples/snapshots/' + entry.ref.snapshotId);
  await validatePackage(pkg.manifest, pkg.files, entry.ref, entry.scope, parents);
  for (const [name, bytes] of new Map([['manifest.json', pkg.manifest], ...pkg.files])) assets['/snapshots/' + entry.ref.snapshotId + '/' + name] = { body: Buffer.from(bytes).toString('base64'), type: 'application/octet-stream', snapshot: true };
}
const result = await build({ stdin: { contents: `import { handleChat, json } from './server/api.mjs';
import { assetHeaders } from './server/headers.mjs';
const assets = ${JSON.stringify(assets)};
export default { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/chat') return handleChat(request, env);
  if (path === '/api/health') return json({ configured: Boolean(env.DEEPSEEK_API_KEY) });
  if (!['GET', 'HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
  const asset = Object.hasOwn(assets, path) ? assets[path] : null;
  if (!asset) return json({error:'Not found'},404);
  let bytes = Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
  let nonce;
  if (asset.type.startsWith('text/html')) {
    nonce = crypto.randomUUID().replaceAll('-', '');
    bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace('<head>', '<head><meta name="snapshot-script-nonce" content="' + nonce + '">'));
  }
  return new Response(request.method === 'HEAD' ? null : bytes, { headers: assetHeaders(asset, nonce) });
}};`, resolveDir: process.cwd(), sourcefile: 'worker-entry.mjs' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
await writeFile('dist/server/index.js', result.outputFiles[0].contents);
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
console.log('Built web assets and Worker with ' + catalog.entries.length + ' validated dummy snapshots; no env files read.');
