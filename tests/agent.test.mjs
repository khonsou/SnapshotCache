import test from 'node:test';
import assert from 'node:assert/strict';
import { validProjectKey } from '../src/agent/intent.mjs';
import { parseSnapshotDraft } from '../src/agent/draft.mjs';
import { AgentRunError, runAgent } from '../src/agent/run.mjs';
import { runtimeSystemPrompt } from '../src/agent/prompt.mjs';

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试快照</title><style>body{font:16px sans-serif}</style></head><body><h1 id="title"></h1><script>'use strict';document.getElementById('title').textContent=Snapshot.readJSON('main').title;</script></body></html>`;
const draft = {
  mode: 'snapshot',
  reply: '已根据用户提供的测试数据生成快照。',
  title: '测试项目概览',
  datasets: [{ id: 'main', mediaType: 'application/json', content: { title: '本周进展' } }],
  presentation: { html, initialState: { tab: 'summary' } },
  notes: ['测试数据'],
};
const env = { DEEPSEEK_API_KEY: 'test-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const base = {
  env, project: '测试项目', projectKey: 'test-project', context: '本周完成三项任务。',
  messages: [{ role: 'user', content: '生成一个项目看板快照' }], actorId: 'user-1',
  now: () => new Date('2026-09-11T12:00:00Z'), idFactory: () => 'fixed-id',
};

test('project keys are validated without semantic response routing', () => {
  assert.equal(validProjectKey('project-1'), true);
  assert.equal(validProjectKey('../project'), false);
});

test('auto mode treats questions about an existing board as text, not a snapshot request', () => {
  const prompt = runtimeSystemPrompt({ project: '项目', context: '', requestedMode: 'auto', hasProjectHttp: true });
  assert.match(prompt, /询问现有看板、卡片、数据、数量或状态/);
  assert.match(prompt, /直接用文本回答/);
  assert.doesNotMatch(prompt, /强制调用 submit_snapshot/);
});

test('snapshot draft parser is strict and rejects runtime attempts to set trusted fields', () => {
  assert.equal(parseSnapshotDraft(JSON.stringify(draft)).title, draft.title);
  assert.throws(() => parseSnapshotDraft(JSON.stringify({ ...draft, snapshotId: 'runtime-choice' })), /draft_field_unknown/);
  assert.throws(() => parseSnapshotDraft(JSON.stringify({ ...draft, datasets: [{ id: '../escape', mediaType: 'application/json', content: {} }] })), /draft_dataset_id_invalid/);
});

test('text replies come from an injected Agent Runtime and expose actual runtime evidence', async () => {
  let task;
  const runtime = { execute: async value => {
    task = value;
    return { mode: 'text', reply: '先确认负责人。', runtime: 'claude-code', sessionId: 'session-1', turns: 2, toolsUsed: ['project_http_request'] };
  } };
  const result = await runAgent({ ...base, requestedMode: 'auto', runtime });
  assert.equal(task.requestedMode, 'auto');
  assert.equal(task.messages.at(-1).content, base.messages.at(-1).content);
  assert.equal(result.reply, '先确认负责人。');
  assert.deepEqual(result.runtime, { name: 'claude-code', provider: 'deepseek', model: 'deepseek-flash', sessionId: 'session-1', turns: 2, toolsUsed: ['project_http_request'] });
});

test('snapshot run accepts only a validated runtime submission and creates server-owned identity and hashes', async () => {
  const runtime = { execute: async () => ({ mode: 'snapshot', reply: draft.reply, snapshotDraft: draft, runtime: 'claude-code', sessionId: 'session-2', turns: 4, toolsUsed: ['submit_snapshot'] }) };
  const result = await runAgent({ ...base, requestedMode: 'snapshot', runtime });
  assert.equal(result.mode, 'snapshot');
  assert.equal(result.attempt, 0);
  assert.equal(result.candidate.ref.snapshotId, 'gen-fixed-id');
  assert.deepEqual(result.candidate.manifest.scope, { tenantId: 'user-1', projectId: 'test-project' });
  assert.equal(result.candidate.query.originalText, base.messages[0].content);
  assert.equal(result.candidate.manifest.extensions['com.xuyan.generation'].simulated, true);
});

test('invalid runtime snapshot is rejected once without prompt repair or rule fallback', async () => {
  let calls = 0;
  const runtime = { execute: async () => { calls++; return { mode: 'snapshot', reply: 'invalid', snapshotDraft: { mode: 'snapshot' } }; } };
  await assert.rejects(runAgent({ ...base, requestedMode: 'snapshot', runtime }), error => error instanceof AgentRunError && error.code === 'draft_reply_invalid');
  assert.equal(calls, 1);
});

test('missing or malformed Agent Runtime results fail closed', async () => {
  await assert.rejects(runAgent(base), error => error.code === 'agent_runtime_unavailable' && error.status === 503);
  await assert.rejects(runAgent({ ...base, runtime: { execute: async () => ({ mode: 'text', reply: '' }) } }), error => error.code === 'agent_runtime_invalid_result');
  await assert.rejects(runAgent({ ...base, requestedMode: 'snapshot', runtime: { execute: async () => ({ mode: 'text', reply: 'downgraded' }) } }), error => error.code === 'agent_runtime_invalid_result');
});
