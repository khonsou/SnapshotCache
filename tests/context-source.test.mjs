import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';
import { inspectTimelineProjectContext, resolveContextTimelineSource } from '../src/platform/context-source.mjs';

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

function request(content) {
  return new Request('https://app.example.test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': 'user-real' },
    body: JSON.stringify({
      project: '用户创建的 Timeline 项目',
      projectKey: 'user-project-1',
      context,
      messages: [{ role: 'user', content }],
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
});

test('Timeline read intent uses only the user project context and never sends its password to DeepSeek', async () => {
  let modelCalls = 0;
  const fetcher = async (url, options) => {
    if (url === 'https://api.deepseek.com/chat/completions') {
      modelCalls++;
      assert.doesNotMatch(options.body, new RegExp(password));
      if (modelCalls === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'context-call', type: 'function', function: { name: 'timeline_read_board', arguments: '{}' } }] } }] });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: draft } }] });
    }
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
  };
  const ids = ['run', 'snapshot', 'message'];
  const response = await handleChat(request('读取 Timeline，获取项目最新状况。'), baseEnv, { fetcher, idFactory: () => ids.shift(), now: () => new Date('2026-09-12T12:00:00Z') });
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
      assert.deepEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
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
