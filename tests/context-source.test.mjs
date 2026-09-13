import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';
import { inspectTimelineProjectContext, resolveContextTimelineSource } from '../src/platform/context-source.mjs';
import { compileProjectContextRuntime } from '../src/platform/context-runtime.mjs';
import { createProjectToolset } from '../src/agent/tools.mjs';

const password = 'board-password-from-context';
const context = `这是用户创建的 Timeline 项目。
Timeline 地址：https://timeline.example.test/prefix/
Timeline 看板 ID：board-real
Timeline 访问密码：${password}`;

const baseEnv = {
  DEEPSEEK_API_KEY: 'model-secret',
  DEEPSEEK_MODEL: 'deepseek-flash',
};

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>上下文快照</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>'use strict';document.getElementById('title').textContent=Snapshot.readJSON('main').items[0].title;</script></body></html>`;
const draft = JSON.stringify({
  mode: 'snapshot',
  reply: '已基于 Timeline 真实数据生成快照。',
  title: '用户项目 Timeline 概览',
  datasets: [{ id: 'main', mediaType: 'application/json', content: { items: [{ title: '真实事项' }] } }],
  presentation: { html },
  notes: ['Timeline 真实数据'],
});

function request(content, projectContext = context) {
  const messages = Array.isArray(content) ? content : [{ role: 'user', content }];
  return new Request('https://app.example.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'user-real' },
    body: JSON.stringify({
      project: '用户创建的 Timeline 项目',
      projectKey: 'user-project-1',
      context: projectContext,
      messages,
      responseMode: 'auto',
      idempotencyKey: 'context-source-1',
    }),
  });
}

test('user project context is the sole Timeline connection record and its password is redacted for the model', () => {
  const inspected = inspectTimelineProjectContext(context);
  assert.equal(inspected.declared, true);
  assert.deepEqual(inspected.source, {
    type: 'timeline',
    baseUrl: 'https://timeline.example.test/prefix',
    boardId: 'board-real',
    password,
  });
  assert.doesNotMatch(inspected.safeContext, new RegExp(password));
  assert.match(inspected.safeContext, /\[已配置，仅服务端使用\]/);
  assert.deepEqual(resolveContextTimelineSource(context), inspected.source);
  assert.throws(() => resolveContextTimelineSource(context.replace(/Timeline 访问密码：.*/, '')), /timeline_context_invalid/);
  const inline = compileProjectContextRuntime(`链接：[https://timeline.example.test/prefix/](https://timeline.example.test/prefix/) 看板id：board-real，密码${password}。访问说明：先探测再鉴权。`);
  assert.deepEqual(inline.http.allowedPrefixes, [{ origin: 'https://timeline.example.test', pathname: '/prefix' }]);
  assert.match(inline.safeContext, /密码\{\{PROJECT_SECRET_1\}\}/);
  assert.doesNotMatch(inline.safeContext, new RegExp(password));
});

test('generic project HTTP stays inside Context URL scope and only permits read/auth during bring-up', async () => {
  const runtime = compileProjectContextRuntime(context);
  const toolset = createProjectToolset({
    env: baseEnv,
    projectConfig: { http: runtime.http },
    fetcher: async () => assert.fail('blocked request must not reach fetch'),
  });
  await assert.rejects(toolset.execute({ type: 'tool_use', name: 'project_http_request', input: {
    method: 'GET', url: 'https://other.example.test/private',
  } }), error => error.code === 'project_http_target_not_allowed');
  await assert.rejects(toolset.execute({ type: 'tool_use', name: 'project_http_request', input: {
    method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/change-sets', body: {},
  } }), error => error.code === 'project_http_method_not_allowed');
});

test('Agent instructions without an absolute Context source fail explicitly instead of silently falling back to web search', async () => {
  const incomplete = '访问说明：先 GET /api/meta，然后 POST /api/boards/:id/auth，再读取 items。';
  const response = await handleChat(request('统计卡片数量', incomplete), baseEnv, {
    fetcher: async () => assert.fail('invalid Context must fail before the model call'),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: '项目上下文包含 Agent 接入说明，但没有识别到完整的 HTTPS 数据源地址。请把绝对地址与接入说明保存在同一个项目上下文中。',
    errorCode: 'project_context_no_http_source',
  });
});

async function timelineResponse(url, options) {
  const path = new URL(url).pathname;
  const headers = { 'X-Protocol-Version': '19.2' };
  if (path.endsWith('/api/meta')) return Response.json({ protocol_version: '19.2', capabilities: ['items.read'], features: {}, enums: {} }, { headers });
  if (path.endsWith('/auth')) {
    assert.deepEqual(JSON.parse(options.body), { password });
    return Response.json({ token: 'board-token' }, { headers });
  }
  if (path.endsWith('/items')) return Response.json({ items: [{ id: 'one', title: '真实事项' }], board_version: 8 }, { headers });
  if (path.endsWith('/products')) return Response.json({ products: [] }, { headers });
  if (path.endsWith('/members')) return Response.json({ members: [] }, { headers });
  assert.fail(`unexpected URL ${url}`);
}

test('the generic server agent follows project Context through auth and data reads without leaking secrets', async () => {
  let modelCalls = 0;
  const fetcher = async (url, options) => {
    if (url === 'https://api.deepseek.com/anthropic/v1/messages') {
      modelCalls++;
      assert.doesNotMatch(options.body, new RegExp(password));
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tools.map(tool => tool.name), ['web_search', 'project_http_request']);
      assert.match(body.system, /真实的服务器端 HTTP 能力/);
      assert.match(body.system, /\{\{PROJECT_SECRET_1\}\}/);
      if (modelCalls === 1) {
        assert.deepEqual(body.messages, [
          { role: 'user', content: '帮我看看当前项目的看板。' },
          { role: 'assistant', content: '你具体想了解什么？' },
          { role: 'user', content: '那一共有多少张？' },
        ]);
        return Response.json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'auth-call', name: 'project_http_request', input: {
          method: 'POST', url: 'https://timeline.example.test/prefix/api/boards/board-real/auth', body: { password: '{{PROJECT_SECRET_1}}' },
        } }] });
      }
      assert.equal(body.messages.at(-1).content[0].type, 'tool_result');
      if (modelCalls === 2) {
        assert.match(body.messages.at(-1).content[0].content, /\{\{PROJECT_SECRET_2\}\}/);
        assert.doesNotMatch(body.messages.at(-1).content[0].content, /board-token/);
        return Response.json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'items-call', name: 'project_http_request', input: {
          method: 'GET', url: 'https://timeline.example.test/prefix/api/boards/board-real/items', headers: { Authorization: 'Bearer {{PROJECT_SECRET_2}}' },
        } }] });
      }
      assert.match(body.messages.at(-1).content[0].content, /真实事项/);
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '当前看板共有 1 张卡片。' }] });
    }
    return timelineResponse(url, options);
  };
  const response = await handleChat(request([
    { role: 'user', content: '帮我看看当前项目的看板。' },
    { role: 'assistant', content: '你具体想了解什么？' },
    { role: 'user', content: '那一共有多少张？' },
  ]), baseEnv, { fetcher, idFactory: () => 'unused', now: () => new Date('2026-09-12T12:00:00Z') });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result, { reply: '当前看板共有 1 张卡片。', truncated: false });
  assert.equal(modelCalls, 3);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
});

test('an explicit snapshot request lets DeepSeek choose Timeline and produces a sourced package', async () => {
  let modelCalls = 0;
  const fetcher = async (url, options) => {
    if (url === 'https://api.deepseek.com/chat/completions') {
      modelCalls++;
      assert.doesNotMatch(options.body, new RegExp(password));
      if (modelCalls === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'context-call', type: 'function', function: { name: 'timeline_read_board', arguments: '{}' } }] } }] });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: draft } }] });
    }
    return timelineResponse(url, options);
  };
  const ids = ['run', 'snapshot', 'message'];
  const response = await handleChat(request('读取 Timeline 并生成项目快照。'), baseEnv, { fetcher, idFactory: () => ids.shift(), now: () => new Date('2026-09-12T12:00:00Z') });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.sourceKind, 'timeline');
  assert.equal(modelCalls, 2);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(password));
});

test('unrelated chat remains a normal DeepSeek request even when the project context declares Timeline', async () => {
  const response = await handleChat(request('讲一个关于猫的冷笑话。'), baseEnv, {
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.tools.map(tool => tool.name), ['web_search', 'project_http_request']);
      assert.deepEqual(body.tool_choice, { type: 'auto' });
      assert.match(body.system, /工作相关或无关的问题都直接回答/);
      assert.doesNotMatch(options.body, new RegExp(password));
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '猫最怕鼠标。' }] });
    },
    idFactory: () => 'fixed',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: '猫最怕鼠标。', truncated: false });
});
