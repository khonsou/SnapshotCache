import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';
import { compileProjectContextRuntime } from '../src/platform/context-runtime.mjs';
import { createProjectHttpExecutor } from '../src/agent/tools.mjs';

const password = 'board-password-from-context';
const context = `这是用户创建的 Timeline 项目。
Timeline 地址：https://timeline.example.test/prefix/
Timeline 看板 ID：board-real
Timeline 访问密码：${password}`;
const baseEnv = { DEEPSEEK_API_KEY: 'model-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>上下文快照</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>'use strict';document.getElementById('title').textContent=Snapshot.readJSON('main').items[0].title;</script></body></html>`;
const draft = {
  mode: 'snapshot', reply: '已基于 Timeline 真实数据生成快照。', title: '用户项目 Timeline 概览',
  datasets: [{ id: 'main', mediaType: 'application/json', content: { items: [{ title: '真实事项' }] } }],
  presentation: { html }, notes: ['Timeline 真实数据'],
};

function request(content, projectContext = context, responseMode = 'auto') {
  const messages = Array.isArray(content) ? content : [{ role: 'user', content }];
  return new Request('https://app.example.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'user-real' },
    body: JSON.stringify({ project: '用户创建的 Timeline 项目', projectKey: 'user-project-1', context: projectContext, messages, responseMode, idempotencyKey: 'context-source-1' }),
  });
}

test('user project context is the sole connection record and its password is redacted for the model', () => {
  const compiled = compileProjectContextRuntime(context);
  assert.deepEqual(compiled.http.allowedPrefixes, [{ origin: 'https://timeline.example.test', pathname: '/prefix' }]);
  assert.equal(compiled.http.secrets[0].value, password);
  assert.doesNotMatch(compiled.safeContext, new RegExp(password));
  const inline = compileProjectContextRuntime(`链接：[https://timeline.example.test/prefix/](https://timeline.example.test/prefix/) 看板id：board-real，密码${password}。访问说明：先探测再鉴权。`);
  assert.deepEqual(inline.http.allowedPrefixes, [{ origin: 'https://timeline.example.test', pathname: '/prefix' }]);
  assert.match(inline.safeContext, /密码\{\{PROJECT_SECRET_1\}\}/);
  assert.doesNotMatch(inline.safeContext, new RegExp(password));
});

test('project HTTP host permits only scoped reads, auth and validated change-set writes', async () => {
  const compiled = compileProjectContextRuntime(context);
  const requests = [];
  const execute = createProjectHttpExecutor({ config: compiled.http, fetcher: async (url, options) => {
    requests.push({ url, options });
    return Response.json({ id: url.endsWith('/commit') ? 'committed' : 'cs-1' });
  } });
  await assert.rejects(execute({ input: { method: 'GET', url: 'https://other.example.test/private' } }), error => error.code === 'project_http_target_not_allowed');
  await assert.rejects(execute({ input: { method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/items/one', body: {} } }), error => error.code === 'project_http_method_not_allowed');
  await assert.rejects(execute({ input: { method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/change-sets', body: {} } }), error => error.code === 'project_http_write_invalid');
  const proposal = await execute({ input: {
    method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/change-sets',
    headers: { Authorization: 'Bearer {{PROJECT_SECRET_1}}' },
    body: { base_version: 7, source: 'xuyan-agent', actor: 'user-real', operations: [{ op: 'patch', item_id: 'one', fields: { dimmed: true } }] },
  } });
  assert.equal(proposal.body.id, 'cs-1');
  const commitUrl = 'https://timeline.example.test/prefix/api/boards/board-real/change-sets/cs-1/commit';
  await assert.rejects(execute({ input: { method: 'POST', url: commitUrl, headers: { Authorization: 'Bearer {{PROJECT_SECRET_1}}' } } }), error => error.code === 'project_http_idempotency_required');
  const committed = await execute({ input: { method: 'POST', url: commitUrl, headers: { Authorization: 'Bearer {{PROJECT_SECRET_1}}', 'Idempotency-Key': 'write-one-v1' } } });
  assert.equal(committed.body.id, 'committed');
  assert.equal(JSON.parse(requests[0].options.body).operations[0].fields.dimmed, true);
  assert.equal(requests[1].options.headers['Idempotency-Key'], 'write-one-v1');
});

test('Context without an absolute source still enters the Agent Runtime without an HTTP tool', async () => {
  const incomplete = '访问说明：先 GET /api/meta，然后 POST /api/boards/:id/auth，再读取 items。';
  const runtime = { execute: async task => {
    assert.equal(task.context, incomplete);
    assert.equal(task.projectConfig, null);
    return { mode: 'text', reply: '缺少可访问的绝对地址。', runtime: 'claude-code', sessionId: 'no-http', turns: 1, toolsUsed: [] };
  } };
  const response = await handleChat(request('统计卡片数量', incomplete), baseEnv, { runtime });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, '缺少可访问的绝对地址。');
});

async function timelineResponse(url, options) {
  const path = new URL(url).pathname;
  const headers = { 'X-Protocol-Version': '19.2' };
  if (path.endsWith('/api/meta')) return Response.json({ protocol_version: '19.2', capabilities: ['items.read'] }, { headers });
  if (path.endsWith('/auth')) { assert.deepEqual(JSON.parse(options.body), { password }); return Response.json({ token: 'board-token' }, { headers }); }
  if (path.endsWith('/items')) { assert.equal(options.headers.Authorization, 'Bearer board-token'); return Response.json({ items: [{ id: 'one', title: '真实事项' }] }, { headers }); }
  assert.fail(`unexpected URL ${url}`);
}

test('MCP-facing project HTTP executor performs auth and data reads without exposing the real token to the Agent', async () => {
  const compiled = compileProjectContextRuntime(context);
  const execute = createProjectHttpExecutor({ config: compiled.http, fetcher: timelineResponse });
  const auth = await execute({ input: { method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/auth', body: { password: '{{PROJECT_SECRET_1}}' } } });
  assert.match(JSON.stringify(auth), /PROJECT_SECRET_2/);
  assert.doesNotMatch(JSON.stringify(auth), /board-token/);
  const items = await execute({ input: { method: 'GET', url: 'https://timeline.example.test/prefix/api/boards/board-real/items', headers: { Authorization: 'Bearer {{PROJECT_SECRET_2}}' } } });
  assert.equal(items.body.items.length, 1);
});

test('API starts the Agent Runtime with redacted Context and request-scoped secret configuration', async () => {
  const runtime = { execute: async task => {
    assert.doesNotMatch(task.context, new RegExp(password));
    assert.equal(task.projectConfig.http.secrets[0].value, password);
    assert.deepEqual(task.projectConfig.http.allowedPrefixes, [{ origin: 'https://timeline.example.test', pathname: '/prefix' }]);
    return { mode: 'text', reply: '当前看板共有 1 张卡片。', runtime: 'claude-code', sessionId: 'timeline-session', turns: 3, toolsUsed: ['project_http_request'] };
  } };
  const response = await handleChat(request('统计项目看板有多少张卡片。'), baseEnv, { runtime, idFactory: () => 'run' });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.reply, '当前看板共有 1 张卡片。');
  assert.deepEqual(result.agentRun.toolsUsed, ['project_http_request']);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
});

test('runtime-submitted snapshot produces a sourced package without a semantic routing rule', async () => {
  const runtime = { execute: async () => ({
    mode: 'snapshot', reply: draft.reply, snapshotDraft: draft, runtime: 'claude-code', sessionId: 'snapshot-session', turns: 5,
    toolsUsed: ['project_http_request', 'submit_snapshot'],
    source: { sourceId: 'timeline', revision: '8', observedAt: '2026-09-12T12:00:00Z', kind: 'timeline', boardId: 'board-real', protocolVersion: '19.2' },
  }) };
  const ids = ['run', 'snapshot', 'message'];
  const response = await handleChat(request('读取 Timeline 并生成项目快照。'), baseEnv, { runtime, idFactory: () => ids.shift(), now: () => new Date('2026-09-12T12:00:00Z') });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.sourceKind, 'timeline');
  assert.deepEqual(result.agentRun.toolsUsed, ['project_http_request', 'submit_snapshot']);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
});

test('unrelated chat uses the same Agent Runtime without project-topic restrictions', async () => {
  const runtime = { execute: async task => {
    assert.equal(task.requestedMode, 'auto');
    assert.equal(task.messages.at(-1).content, '讲一个关于猫的冷笑话。');
    return { mode: 'text', reply: '猫最怕鼠标。', runtime: 'claude-code', sessionId: 'chat-session', turns: 1, toolsUsed: [] };
  } };
  const response = await handleChat(request('讲一个关于猫的冷笑话。'), baseEnv, { runtime, idFactory: () => 'fixed' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, '猫最怕鼠标。');
});
