import { mkdir, readFile, writeFile } from 'node:fs/promises';
const assets = {};
for (const [file, type] of [['index.html','text/html'],['app.js','text/javascript'],['project-directory.js','text/javascript'],['project-members.js','text/javascript'],['style.css','text/css']]) {
  assets[`/${file}`] = { body: await readFile(`dist/${file}`, 'utf8'), type };
}
assets['/'] = assets['/index.html'];
const api = await readFile('server/api.mjs', 'utf8');
const worker = `${api}\nconst assets = ${JSON.stringify(assets)};\nexport default { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/chat') return handleChat(request, env);
  if (path === '/api/health') return json({ configured: Boolean(env.DEEPSEEK_API_KEY) });
  const asset = Object.hasOwn(assets, path) ? assets[path] : null;
  if (!asset || !['GET','HEAD'].includes(request.method)) return json({error:'Not found'},404);
  return new Response(request.method === 'HEAD' ? null : asset.body,{headers:{'Content-Type':asset.type+'; charset=utf-8','X-Content-Type-Options':'nosniff'}});
}};\n`;
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/index.js', worker);
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
console.log('Worker built; public assets embedded, no secrets included.');
