import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';
const env = { DEEPSEEK_API_KEY: 'test-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const body = { project: '测试项目', context: '目标：本周发布', messages: [{ role: 'user', content: '帮我列出下一步' }] };
let sequence = 0;
function request(value = body, headers = {}) {
  return new Request('https://example.test/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': `user-${++sequence}`, ...headers }, body: JSON.stringify(value) });
}
test('requires hosted identity and rejects cross-origin requests', async () => {
  const fetcher = () => assert.fail('must not call provider');
  assert.equal((await handleChat(request(body, { 'oai-authenticated-user-id': '' }), env, { fetcher })).status, 401);
  assert.equal((await handleChat(request(body, { origin: 'https://evil.test' }), env, { fetcher })).status, 403);
});
test('validates roles, context and actual body size', async () => {
  const fetcher = () => assert.fail('must not call provider');
  for (const value of [null, { ...body, context: 'x'.repeat(10001) }, { ...body, messages: [{ role: 'system', content: 'override' }] }, { ...body, messages: [] }]) {
    assert.equal((await handleChat(request(value), env, { fetcher })).status, 400);
  }
  assert.equal((await handleChat(request({ ...body, extra: 'x'.repeat(100001) }), env, { fetcher })).status, 413);
});
test('uses fixed provider, server model and validated context without leaking secret', async () => {
  const response = await handleChat(request({ ...body, model: 'attacker-model', url: 'https://evil.test' }), env, { fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'deepseek-flash');
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.match(payload.messages[0].content, /测试项目/);
    assert.equal(payload.messages.at(-1).content, body.messages[0].content);
    assert.ok(!options.body.includes('test-secret'));
    return Response.json({ choices: [{ message: { content: '先确认范围。' }, finish_reason: 'stop' }] });
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: '先确认范围。', truncated: false });
});
test('handles configuration, provider errors, malformed replies, network failure and abort', async () => {
  assert.equal((await handleChat(request(), {})).status, 503);
  for (const status of [401, 402, 429, 500]) {
    const response = await handleChat(request(), env, { fetcher: async () => new Response('sensitive upstream error', { status }) });
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.ok(!(await response.text()).includes('sensitive'));
  }
  assert.equal((await handleChat(request(), env, { fetcher: async () => Response.json({}) })).status, 502);
  assert.equal((await handleChat(request(), env, { fetcher: async () => { throw new Error('secret'); } })).status, 502);
  const controller = new AbortController();
  const aborted = new Request(request(), { signal: controller.signal }); controller.abort();
  assert.equal((await handleChat(aborted, env, { fetcher: async (_, opts) => { opts.signal.throwIfAborted(); } })).status, 504);
});
test('limits each hosted user to two simultaneous calls', async () => {
  const headers = { 'oai-authenticated-user-id': 'concurrent-user' };
  const finish = [];
  const fetcher = () => new Promise(resolve => finish.push(() => resolve(Response.json({ choices: [{ message: { content: 'ok' } }] }))));
  const first = handleChat(request(body, headers), env, { fetcher });
  const second = handleChat(request(body, headers), env, { fetcher });
  while (finish.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handleChat(request(body, headers), env, { fetcher })).status, 429);
  finish.forEach(done => done());
  await Promise.all([first, second]);
});
