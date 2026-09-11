import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleChat, json } from './api.mjs';
const assets = new Map([['/', ['index.html','text/html']], ['/index.html',['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/project-directory.js',['project-directory.js','text/javascript']], ['/project-members.js',['project-members.js','text/javascript']], ['/style.css',['style.css','text/css']]]);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
    let response;
    if (url.pathname === '/api/chat') {
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const request = new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(['GET','HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }) });
      response = await handleChat(request, process.env, { local: true });
    } else if (url.pathname === '/api/health') {
      response = json({ configured: Boolean(process.env.DEEPSEEK_API_KEY) });
    } else if (assets.has(url.pathname) && ['GET','HEAD'].includes(req.method)) {
      const [file, type] = assets.get(url.pathname);
      response = new Response(req.method === 'HEAD' ? null : await readFile(new URL(`../dist/${file}`, import.meta.url)), { headers: { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' } });
    } else response = json({ error: 'Not found' }, 404);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!res.headersSent) res.writeHead(500); res.end('服务暂不可用'); }
});
server.requestTimeout = 60000;
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`序言：http://127.0.0.1:${server.address().port}`));
