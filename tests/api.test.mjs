import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat, handleChatStream } from '../server/api.mjs';

const env = { DEEPSEEK_API_KEY: 'test-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const body = {
  project: '测试项目', projectKey: 'test-project', context: '目标：本周发布',
  messages: [{ role: 'user', content: '帮我列出下一步' }], responseMode: 'auto', idempotencyKey: 'idem-text',
};
let sequence = 0;
function request(value = body, headers = {}) {
  return new Request('https://example.test/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': `user-${++sequence}`, ...headers }, body: JSON.stringify(value) });
}

const textRuntime = (reply = '先确认范围。') => ({ execute: async () => ({
  mode: 'text', reply, runtime: 'claude-code', sessionId: 'session-api', turns: 1, toolsUsed: [],
}) });

test('requires hosted identity and rejects cross-origin requests', async () => {
  const runtime = { execute: () => assert.fail('must not start runtime') };
  assert.equal((await handleChat(request(), env, { runtime })).status, 401);
  assert.equal((await handleChat(request(body, { origin: 'https://evil.test' }), env, { runtime, identity: { id: 'user-test' } })).status, 403);
});

test('validates roles, context, project identity and actual body size', async () => {
  const runtime = { execute: () => assert.fail('must not start runtime') };
  for (const value of [null, { ...body, context: 'x'.repeat(10001) }, { ...body, messages: [{ role: 'system', content: 'override' }] }, { ...body, messages: [] }, { ...body, projectKey: '../bad' }, { ...body, idempotencyKey: '' }]) {
    assert.equal((await handleChat(request(value), env, { runtime, identity: { id: 'user-test' } })).status, 400);
  }
  assert.equal((await handleChat(request({ ...body, extra: 'x'.repeat(100001) }), env, { runtime, identity: { id: 'user-test' } })).status, 413);
});

test('passes only validated project data to the Agent Runtime and ignores client model overrides', async () => {
  let task;
  const runtime = { execute: async value => {
    task = value;
    return { mode: 'text', reply: '先确认范围。', runtime: 'claude-code', sessionId: 'session-api', turns: 1, toolsUsed: [] };
  } };
  const response = await handleChat(request({ ...body, model: 'attacker-model', url: 'https://evil.test' }), env, { runtime, identity: { id: 'user-test' }, idFactory: () => 'fixed' });
  assert.equal(response.status, 200);
  assert.equal(task.env.DEEPSEEK_MODEL, 'deepseek-flash');
  assert.equal(task.project, '测试项目');
  assert.equal(task.context, body.context);
  assert.equal(task.messages.at(-1).content, body.messages.at(-1).content);
  assert.deepEqual(await response.json(), {
    reply: '先确认范围。', runId: 'run-fixed',
    agentRun: { name: 'claude-code', provider: 'deepseek', model: 'deepseek-flash', sessionId: 'session-api', turns: 1, toolsUsed: [] }, truncated: false,
  });
});

test('fails closed when Agent Runtime is absent or reports an execution failure', async () => {
  assert.equal((await handleChat(request(), env, { identity: { id: 'user-test' } })).status, 503);
  const runtime = { execute: async () => { const error = new Error('private'); error.code = 'agent_runtime_failed'; error.status = 502; throw error; } };
  const response = await handleChat(request(), env, { runtime, identity: { id: 'user-test' } });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private'));
});

test('limits each hosted user to two simultaneous Agent Runtime sessions', async () => {
  const headers = { 'oai-authenticated-user-id': 'concurrent-user' };
  const finish = [];
  const runtime = { execute: () => new Promise(resolve => finish.push(() => resolve({ mode: 'text', reply: 'ok', runtime: 'claude-code', toolsUsed: [] }))) };
  const first = handleChat(request(body, headers), env, { runtime, identity: { id: 'concurrent-user' } });
  const second = handleChat(request(body, headers), env, { runtime, identity: { id: 'concurrent-user' } });
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handleChat(request(body, headers), env, { runtime, identity: { id: 'concurrent-user' } })).status, 429);
  finish.forEach(done => done());
  await Promise.all([first, second]);
});

test('chat stream emits only approved progress fields and preserves final JSON result', async () => {
  const runtime = { execute: async ({ onProgress }) => {
    onProgress({ phase: 'runtime_ready', secret: 'must-not-stream' });
    onProgress({ phase: 'tool_started', tool: 'project_http_request', step: 1, source: 2, action: 'read', url: 'https://private.example.test', token: 'must-not-stream' });
    onProgress({ phase: 'tool_started', tool: 'unapproved_tool', secret: 'must-not-stream' });
    onProgress({ phase: 'tool_finished', tool: 'project_http_request', step: 1, outcome: 'failed', status: 403, durationMs: 1250, result: 'must-not-stream' });
    return { mode: 'text', reply: '查询完成。', runtime: 'claude-code', sessionId: 'session-stream', turns: 2, toolsUsed: ['project_http_request'] };
  } };
  const response = handleChatStream(request(), env, { runtime, identity: { id: 'stream-user' }, idFactory: () => 'stream' });
  assert.match(response.headers.get('content-type'), /text\/event-stream/u);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const events = (await response.text()).split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const lines = frame.split('\n');
    return { type: lines[0].slice(7), value: JSON.parse(lines[1].slice(6)) };
  });
  assert.deepEqual(events.filter(event => event.type === 'progress').map(event => event.value), [
    { phase: 'accepted' }, { phase: 'runtime_ready' },
    { phase: 'tool_started', tool: 'project_http_request', step: 1, source: 2, action: 'read' },
    { phase: 'tool_finished', tool: 'project_http_request', step: 1, outcome: 'failed', status: 403, durationMs: 1250 },
  ]);
  const final = events.at(-1);
  assert.equal(final.type, 'result');
  assert.equal(final.value.status, 200);
  assert.equal(final.value.body.reply, '查询完成。');
  assert.doesNotMatch(JSON.stringify(events), /must-not-stream|private\.example/u);
});

test('chat stream preserves unauthenticated error and does not start runtime', async () => {
  const response = handleChatStream(request(), env, { runtime: { execute: () => assert.fail('runtime must not start') } });
  const output = await response.text();
  assert.match(output, /"status":401/u);
  assert.doesNotMatch(output, /event: progress/u);
});

test('chat progress arrives before the Agent finishes', async () => {
  let finish;
  const runtime = { execute: ({ onProgress }) => {
    onProgress({ phase: 'runtime_ready' });
    return new Promise(resolve => { finish = () => resolve({ mode: 'text', reply: '已完成。', runtime: 'claude-code', toolsUsed: [] }); });
  } };
  const response = handleChatStream(request(), env, { runtime, identity: { id: 'early-progress-user' } });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: progress/u);
  assert.equal(typeof finish, 'function');
  finish();
  let remainder = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    remainder += new TextDecoder().decode(next.value);
  }
  assert.match(remainder, /"reply":"已完成。"/u);
});
