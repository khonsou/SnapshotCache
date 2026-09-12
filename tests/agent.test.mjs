import test from 'node:test';
import assert from 'node:assert/strict';
import { decideResponseMode } from '../src/agent/intent.mjs';
import { parseSnapshotDraft } from '../src/agent/draft.mjs';
import { runAgent } from '../src/agent/run.mjs';

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

function reply(content, finishReason = 'stop') {
  return Response.json({ choices: [{ message: { content }, finish_reason: finishReason }], usage: { total_tokens: 20 } });
}

test('response mode is explicit or inferred only from clear visualization language', () => {
  assert.equal(decideResponseMode('帮我列出下一步'), 'text');
  assert.equal(decideResponseMode('请生成一个项目看板快照'), 'snapshot');
  assert.equal(decideResponseMode('请按照 Agent Support 接入指南读取 Timeline，获取项目最新状况。', 'auto', { sourceType: 'timeline' }), 'snapshot');
  assert.equal(decideResponseMode('看看项目当前进展怎么样', 'auto', { sourceType: 'timeline' }), 'snapshot');
  assert.equal(decideResponseMode('解释一下 Timeline 是什么', 'auto', { sourceType: 'timeline' }), 'text');
  assert.equal(decideResponseMode('请读取 Timeline', 'auto'), 'text');
  assert.equal(decideResponseMode('随便聊聊', 'snapshot'), 'snapshot');
  assert.throws(() => decideResponseMode('x', 'invalid'));
});

test('snapshot draft parser is strict and rejects model attempts to set trusted fields', () => {
  assert.equal(parseSnapshotDraft(JSON.stringify(draft)).title, draft.title);
  assert.equal(parseSnapshotDraft('```json\n' + JSON.stringify(draft) + '\n```').datasets[0].id, 'main');
  assert.throws(() => parseSnapshotDraft(JSON.stringify({ ...draft, snapshotId: 'model-choice' })), /draft_field_unknown/);
  assert.throws(() => parseSnapshotDraft(JSON.stringify({ ...draft, datasets: [{ id: '../escape', mediaType: 'application/json', content: {} }] })), /draft_dataset_id_invalid/);
});

test('snapshot run creates server-owned query, identity, hashes and a validated package', async () => {
  let payload;
  const result = await runAgent({ ...base, requestedMode: 'snapshot', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    payload = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.ok(!options.body.includes('test-secret'));
    return reply(JSON.stringify(draft));
  } });
  assert.equal(result.mode, 'snapshot');
  assert.equal(result.attempt, 0);
  assert.equal(result.candidate.ref.snapshotId, 'gen-fixed-id');
  assert.deepEqual(result.candidate.manifest.scope, { tenantId: 'user-1', projectId: 'test-project' });
  assert.equal(result.candidate.query.originalText, base.messages[0].content);
  assert.equal(result.candidate.query.identity.intent.name, 'agent.snapshot.generate');
  assert.equal(result.candidate.manifest.extensions['com.xuyan.generation'].simulated, true);
  assert.equal(payload.max_tokens, 7000);
});

test('invalid first candidate is repaired once and never partially accepted', async () => {
  const outputs = ['not json', JSON.stringify(draft)];
  const prompts = [];
  const result = await runAgent({ ...base, requestedMode: 'snapshot', fetcher: async (_, options) => {
    const payload = JSON.parse(options.body); prompts.push(payload.messages[0].content);
    return reply(outputs.shift());
  } });
  assert.equal(result.attempt, 1);
  assert.match(prompts[1], /draft_json_invalid/);
});

test('unsafe generated presentation is rejected and repaired before it can be committed', async () => {
  const unsafe = { ...draft, presentation: { ...draft.presentation, html: draft.presentation.html.replace('<h1 ', '<h1 onclick="location.href=\'https://example.invalid/leak\'" ') } };
  const outputs = [JSON.stringify(unsafe), JSON.stringify(draft)];
  const prompts = [];
  const result = await runAgent({ ...base, requestedMode: 'snapshot', fetcher: async (_, options) => {
    prompts.push(JSON.parse(options.body).messages[0].content);
    return reply(outputs.shift());
  } });
  assert.equal(result.attempt, 1);
  assert.match(prompts[1], /candidate_validation_failed/);
  assert.doesNotMatch(new TextDecoder().decode(result.candidate.files.get('presentation/index.html')), /example\.invalid/);
});

test('text mode preserves the existing provider contract', async () => {
  const result = await runAgent({ ...base, messages: [{ role: 'user', content: '帮我列出下一步' }], requestedMode: 'auto', fetcher: async (_, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, 1500);
    assert.match(payload.messages[0].content, /测试项目/);
    return reply('先确认负责人。');
  } });
  assert.deepEqual({ mode: result.mode, reply: result.reply, truncated: result.truncated }, { mode: 'text', reply: '先确认负责人。', truncated: false });
});

test('configured Timeline text prompt describes the available tool without claiming data was read', async () => {
  const projectConfig = { source: { type: 'timeline' } };
  await runAgent({ ...base, projectConfig, messages: [{ role: 'user', content: '解释一下 Timeline 是什么' }], requestedMode: 'auto', fetcher: async (_, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content, /具备服务端只读 Timeline 工具/);
    assert.doesNotMatch(payload.messages[0].content, /当前阶段没有联网、Timeline 取数/);
    return reply('Timeline 是当前项目的数据源。');
  } });
});
