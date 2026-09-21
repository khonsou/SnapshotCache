import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../server/api.mjs';
import { handleSnapshotRequest } from '../server/snapshots.mjs';
import { createMemorySnapshotStore } from '../src/platform/store.mjs';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>动态报告</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>'use strict';document.getElementById('title').textContent=Snapshot.readJSON('main').title;</script></body></html>`;
const draft = {
  mode: 'snapshot', reply: '已根据用户提供的测试数据生成报告。', title: '动态测试报告',
  datasets: [{ id: 'main', mediaType: 'application/json', content: { title: '本周测试结果' } }],
  presentation: { html }, notes: ['用户提供数据'],
};
const env = { DEEPSEEK_API_KEY: 'test-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const body = { project: '测试项目', projectKey: 'alpha', context: '当前是 P2 测试。', messages: [{ role: 'user', content: '生成一个测试报告快照' }], responseMode: 'snapshot', idempotencyKey: 'idem-1' };

function chatRequest(value = body, user = 'user-a') {
  return new Request('https://example.test/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'oai-authenticated-user-id': user }, body: JSON.stringify(value) });
}

function get(path, user = 'user-a') {
  return new Request('https://example.test' + path, { headers: { 'oai-authenticated-user-id': user } });
}

test('snapshot API commits once, replays idempotently and serves only the owning project', async () => {
  const store = createMemorySnapshotStore();
  let runtimeCalls = 0;
  const ids = ['run-one', 'snapshot-one', 'message-one', 'unused-run'];
  const options = {
    store,
    now: () => new Date('2026-09-11T13:00:00Z'),
    idFactory: () => ids.shift(),
    runtime: { execute: async () => { runtimeCalls++; return { mode: 'snapshot', reply: draft.reply, snapshotDraft: draft, runtime: 'claude-code', sessionId: 'snapshot-session', turns: 2, toolsUsed: ['submit_snapshot'] }; } },
  };
  const first = await handleChat(chatRequest(), env, { ...options, identity: { id: 'user-a' } });
  assert.equal(first.status, 200);
  const created = await first.json();
  assert.equal(created.snapshotStatus, 'generated');
  assert.equal(created.snapshotRef.snapshotId, 'gen-snapshot-one');
  assert.deepEqual(created.scope, { tenantId: 'user-a', projectId: 'alpha' });

  const second = await handleChat(chatRequest(), env, { ...options, identity: { id: 'user-a' } });
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).snapshotRef, created.snapshotRef);
  assert.equal(runtimeCalls, 1);

  const list = await handleSnapshotRequest(get('/api/projects/alpha/snapshots'), { SNAPSHOT_STORE: store }, { identity: { id: 'user-a' } });
  assert.equal(list.status, 200);
  const entries = (await list.json()).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].ref, created.snapshotRef);

  const manifest = await handleSnapshotRequest(get('/api/projects/alpha/snapshots/gen-snapshot-one/manifest'), { SNAPSHOT_STORE: store }, { identity: { id: 'user-a' } });
  assert.equal(manifest.status, 200);
  const manifestJSON = JSON.parse(await manifest.text());
  assert.equal(manifestJSON.integrity.manifestHash, created.snapshotRef.manifestHash);

  const resource = await handleSnapshotRequest(get('/api/projects/alpha/snapshots/gen-snapshot-one/resources/data.main'), { SNAPSHOT_STORE: store }, { identity: { id: 'user-a' } });
  assert.equal(resource.status, 200);
  assert.deepEqual(JSON.parse(await resource.text()), { title: '本周测试结果' });

  assert.equal((await handleSnapshotRequest(get('/api/projects/beta/snapshots/gen-snapshot-one/manifest'), { SNAPSHOT_STORE: store }, { identity: { id: 'user-a' } })).status, 404);
  assert.equal((await handleSnapshotRequest(get('/api/projects/alpha/snapshots/gen-snapshot-one/manifest', 'user-b'), { SNAPSHOT_STORE: store }, { identity: { id: 'user-b' } })).status, 404);
});

test('explicit snapshot failure is recorded and never downgraded to success text', async () => {
  const store = createMemorySnapshotStore();
  let runtimeCalls = 0;
  const ids = ['run-failed'];
  const response = await handleChat(chatRequest({ ...body, idempotencyKey: 'idem-failed', responseMode: 'snapshot' }), env, {
    store, identity: { id: 'user-a' },
    now: () => new Date('2026-09-11T13:10:00Z'),
    idFactory: () => ids.shift(),
    runtime: { execute: async () => { runtimeCalls++; return { mode: 'snapshot', reply: 'invalid', snapshotDraft: { mode: 'snapshot' }, runtime: 'claude-code' }; } },
  });
  assert.equal(response.status, 422);
  const failure = await response.json();
  assert.equal(failure.errorCode, 'draft_reply_invalid');
  assert.equal(runtimeCalls, 1);
  assert.deepEqual(await store.listProjectSnapshots({ actorId: 'user-a', projectKey: 'alpha' }), []);
  const run = await store.getRun({ actorId: 'user-a', projectKey: 'alpha', idempotencyKey: 'idem-failed' });
  assert.equal(run.status, 'failed');
  assert.equal(run.repairCount, 0);
});

test('storage failure marks the run failed instead of leaving a staging success', async () => {
  const baseStore = createMemorySnapshotStore();
  const store = { ...baseStore, commitCandidate: async () => { throw new Error('disk unavailable'); } };
  const ids = ['run-storage', 'snapshot-storage', 'message-storage'];
  const response = await handleChat(chatRequest({ ...body, idempotencyKey: 'idem-storage', responseMode: 'snapshot' }), env, {
    store, identity: { id: 'user-a' },
    now: () => new Date('2026-09-11T13:20:00Z'),
    idFactory: () => ids.shift(),
    runtime: { execute: async () => ({ mode: 'snapshot', reply: draft.reply, snapshotDraft: draft, runtime: 'claude-code', toolsUsed: ['submit_snapshot'] }) },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).errorCode, 'storage_failed');
  const run = await store.getRun({ actorId: 'user-a', projectKey: 'alpha', idempotencyKey: 'idem-storage' });
  assert.equal(run.status, 'failed');
  assert.equal(run.errorCode, 'storage_failed');
});
