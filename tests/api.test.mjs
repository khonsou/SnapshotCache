import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';

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
  assert.equal((await handleChat(request(body, { 'oai-authenticated-user-id': '' }), env, { runtime })).status, 401);
  assert.equal((await handleChat(request(body, { origin: 'https://evil.test' }), env, { runtime })).status, 403);
});

test('validates roles, context, project identity and actual body size', async () => {
  const runtime = { execute: () => assert.fail('must not start runtime') };
  for (const value of [null, { ...body, context: 'x'.repeat(10001) }, { ...body, messages: [{ role: 'system', content: 'override' }] }, { ...body, messages: [] }, { ...body, projectKey: '../bad' }, { ...body, idempotencyKey: '' }]) {
    assert.equal((await handleChat(request(value), env, { runtime })).status, 400);
  }
  assert.equal((await handleChat(request({ ...body, extra: 'x'.repeat(100001) }), env, { runtime })).status, 413);
});

test('passes only validated project data to the Agent Runtime and ignores client model overrides', async () => {
  let task;
  const runtime = { execute: async value => {
    task = value;
    return { mode: 'text', reply: '先确认范围。', runtime: 'claude-code', sessionId: 'session-api', turns: 1, toolsUsed: [] };
  } };
  const response = await handleChat(request({ ...body, model: 'attacker-model', url: 'https://evil.test' }), env, { runtime, idFactory: () => 'fixed' });
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
  assert.equal((await handleChat(request(), env)).status, 503);
  const runtime = { execute: async () => { const error = new Error('private'); error.code = 'agent_runtime_failed'; error.status = 502; throw error; } };
  const response = await handleChat(request(), env, { runtime });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private'));
});

test('limits each hosted user to two simultaneous Agent Runtime sessions', async () => {
  const headers = { 'oai-authenticated-user-id': 'concurrent-user' };
  const finish = [];
  const runtime = { execute: () => new Promise(resolve => finish.push(() => resolve({ mode: 'text', reply: 'ok', runtime: 'claude-code', toolsUsed: [] }))) };
  const first = handleChat(request(body, headers), env, { runtime });
  const second = handleChat(request(body, headers), env, { runtime });
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handleChat(request(body, headers), env, { runtime })).status, 429);
  finish.forEach(done => done());
  await Promise.all([first, second]);
});
