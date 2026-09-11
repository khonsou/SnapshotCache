import { createServer } from 'node:http';
import worker from '../dist/server/index.js';
import { handleChat } from './api.mjs';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const request = new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(['GET','HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }) });
    const response = url.pathname === '/api/chat' ? await handleChat(request, process.env, { local: true }) : await worker.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!res.headersSent) res.writeHead(500); res.end('服务暂不可用'); }
});
server.requestTimeout = 60000;
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`序言：http://127.0.0.1:${server.address().port}`));
