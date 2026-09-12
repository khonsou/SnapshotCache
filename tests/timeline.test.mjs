import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineClient, TimelineError } from '../src/tools/timeline.mjs';

const baseUrl = 'https://timeline.example.test/project-prefix';

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'X-Protocol-Version': '19.2', ...headers } });
}

test('Timeline client discovers protocol, authenticates and reads only approved collections', async () => {
  const requests = [];
  const client = createTimelineClient({ baseUrl, boardId: 'board-1', password: 'server-secret', now: () => new Date('2026-09-12T12:00:00Z'), fetcher: async (url, options) => {
    requests.push({ url, options });
    const path = new URL(url).pathname;
    if (path.endsWith('/api/meta')) return json({ protocol_version: '19.2', capabilities: ['items.read'], features: { groups: true }, enums: { status: ['待执行', '已发布'] } });
    if (path.endsWith('/auth')) return json({ token: 'short-lived-token', expires_at: '2026-09-13T00:00:00Z' });
    assert.equal(options.headers.Authorization, 'Bearer short-lived-token');
    if (path.endsWith('/items')) return json({ items: [{ id: 'item-1', title: '真实事项', status: '待执行' }], board_version: 7 });
    if (path.endsWith('/products')) return json({ products: [{ id: 'product-1', name: '真实产品' }] });
    if (path.endsWith('/members')) return json({ members: [{ id: 'member-1', name: '真实成员' }] });
    assert.fail(`unexpected Timeline URL ${url}`);
  } });
  const result = await client.readBoard({ status: '待执行' });
  assert.equal(result.source.sourceId, 'timeline.board-1');
  assert.equal(result.source.revision, '7');
  assert.equal(result.source.protocolVersion, '19.2');
  assert.equal(result.items[0].title, '真实事项');
  assert.equal(requests.length, 5);
  assert.equal(JSON.parse(requests[1].options.body).password, 'server-secret');
  assert.ok(requests.slice(2).every(item => !JSON.stringify(item.options).includes('server-secret')));
  assert.equal(new URL(requests[2].url).searchParams.get('status'), '待执行');
  assert.ok(requests.every(item => !['PATCH', 'PUT', 'DELETE'].includes(item.options.method)));
});

test('Timeline client reauthenticates once on 401 and never retries 403', async () => {
  let auths = 0;
  let itemReads = 0;
  const client = createTimelineClient({ baseUrl, boardId: 'board-1', password: 'secret', fetcher: async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/api/meta')) return json({ protocol_version: '19.2', capabilities: ['items.read'] });
    if (path.endsWith('/auth')) { auths++; return json({ token: `token-${auths}` }); }
    if (path.endsWith('/items')) { itemReads++; return itemReads === 1 ? json({ error: 'expired' }, 401) : json({ items: [] }); }
    if (path.endsWith('/products')) return json({ products: [] });
    if (path.endsWith('/members')) return json({ members: [] });
    assert.fail();
  } });
  await client.readBoard();
  assert.equal(auths, 2);
  assert.equal(itemReads, 2);

  let forbiddenAuths = 0;
  const forbidden = createTimelineClient({ baseUrl, boardId: 'board-1', password: 'wrong', fetcher: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/api/meta')) return json({ protocol_version: '19.2', capabilities: ['items.read'] });
    if (path.endsWith('/auth')) { forbiddenAuths++; return json({ error: 'forbidden' }, 403); }
    assert.fail();
  } });
  await assert.rejects(forbidden.readBoard(), error => error instanceof TimelineError && error.code === 'timeline_forbidden');
  assert.equal(forbiddenAuths, 1);
});

test('Timeline client rejects unsupported capabilities and untrusted tool filters', async () => {
  const noRead = createTimelineClient({ baseUrl, boardId: 'board-1', password: 'secret', fetcher: async () => json({ protocol_version: '19.2', capabilities: [] }) });
  await assert.rejects(noRead.readBoard(), error => error.code === 'timeline_read_unsupported');
  const client = createTimelineClient({ baseUrl, boardId: 'board-1', password: 'secret', fetcher: async () => assert.fail('invalid filters fail before network') });
  await assert.rejects(client.readBoard({ write: 'yes' }), error => error.code === 'timeline_tool_arguments_invalid');
});
