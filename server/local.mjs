import { createServer } from 'node:http';
import worker from '../dist/server/index.js';
import { handleChat } from './api.mjs';
import { createDaoOAuthApp } from './auth.mjs';
import { createClaudeCodeRuntime } from './claude-runtime.mjs';
import { handleSnapshotRequest } from './snapshots.mjs';
const port = Number(process.env.PORT || 4173);
const publicOrigin = process.env.APP_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
const localEnv = { ...process.env, XUYAN_LOCAL: true, SNAPSHOT_LOCAL: true };
const runtime = createClaudeCodeRuntime();
const auth = createDaoOAuthApp({ env: localEnv });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, publicOrigin);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const request = new Request(url, { method: req.method, headers: req.headers, signal: controller.signal, ...(['GET','HEAD'].includes(req.method) ? {} : { body: req, duplex: 'half' }) });
    let response;
    if (['/auth/login', '/oauth/callback', '/api/session', '/auth/logout'].includes(url.pathname)) response = await auth.handle(request);
    else if (url.pathname === '/api/chat') response = await handleChat(request, localEnv, { auth, runtime });
    else if (url.pathname.startsWith('/api/projects/') && url.pathname.includes('/snapshots')) response = await handleSnapshotRequest(request, localEnv, { auth });
    else response = await worker.fetch(request, localEnv);
    const responseHeaders = Object.fromEntries(response.headers);
    const setCookies = response.headers.getSetCookie?.() || [];
    if (setCookies.length) responseHeaders['set-cookie'] = setCookies;
    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!res.headersSent) res.writeHead(500); res.end('服务暂不可用'); }
});
server.requestTimeout = 190000;
server.listen(port, '127.0.0.1', () => console.log(`序言：http://127.0.0.1:${server.address().port}`));
