import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFileProjectRepository } from '../server/project-repository.mjs';
import { handleProjects } from '../server/projects.mjs';
import { handleChat } from '../server/api.mjs';

const key = () => randomBytes(32).toString('base64');
const auth = { identity: async request => request.headers.get('x-test-id') ? { id: request.headers.get('x-test-id'), name: request.headers.get('x-test-name') || '员工' } : null };
const request = (path, method = 'GET', body, user = 'employee-a') => new Request(`https://example.test${path}`, {
  method, headers: { ...(user ? { 'x-test-id': user, 'x-test-name': user } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('encrypted project aggregate survives restart and deletion removes its conversation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xuyan-project-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const encryptionKey = key();
  const first = createFileProjectRepository({ directory, encryptionKey, production: true });
  const project = await first.create({ title: '团队进度', actorId: 'employee-a', actorName: '员工 A' });
  assert.match(project.id, /^p-[0-9a-f-]{36}$/u);
  await first.update(project.id, { context: '访问密码: secret-12345' }, 'employee-a');
  await first.appendExchange(project.id, { message: '还有多少卡片？', reply: '共 10 张。', actorId: 'employee-a', actorName: '员工 A', idempotencyKey: 'turn-a' });
  const disk = await readFile(join(directory, `${project.id}.json`), 'utf8');
  assert.doesNotMatch(disk, /secret-12345|还有多少卡片|共 10 张/u);
  const restarted = createFileProjectRepository({ directory, encryptionKey, production: true });
  const loaded = await restarted.get(project.id);
  assert.equal(loaded.context, '访问密码: secret-12345');
  assert.deepEqual(loaded.messages.map(item => item.content), ['还有多少卡片？', '共 10 张。']);
  assert.equal((await restarted.list()).length, 1);
  await restarted.remove(project.id);
  await assert.rejects(restarted.get(project.id), error => error.code === 'project_not_found');
  assert.deepEqual(await restarted.list(), []);
});

test('wrong encryption key and invalid project identity fail closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xuyan-project-key-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createFileProjectRepository({ directory, encryptionKey: key(), production: true });
  const project = await repository.create({ title: '共享项目', actorId: 'one' });
  await assert.rejects(createFileProjectRepository({ directory, encryptionKey: key(), production: true }).get(project.id), error => error.code === 'project_data_unreadable');
  await assert.rejects(repository.get('../private'), error => error.code === 'project_not_found');
  await assert.rejects(createFileProjectRepository({ directory, production: true }).initialize(), error => error.code === 'project_key_missing');
});

test('all authenticated employees share a server-owned project; chat ignores submitted context and persists', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xuyan-project-api-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createFileProjectRepository({ directory, encryptionKey: key(), production: true });
  const created = await handleProjects(request('/api/projects', 'POST', { title: '团队进度' }), { auth, repository });
  assert.equal(created.status, 201);
  const { project } = await created.json();
  assert.equal((await handleProjects(request('/api/projects', 'GET', undefined, null), { auth, repository })).status, 401);
  assert.equal((await handleProjects(request(`/api/projects/${project.id}`, 'PATCH', { context: '项目目标：统计卡片。' }), { auth, repository })).status, 200);
  const shared = await handleProjects(request(`/api/projects/${project.id}`, 'GET', undefined, 'employee-b'), { auth, repository });
  assert.equal(shared.status, 200);
  assert.equal((await shared.json()).project.context, '项目目标：统计卡片。');

  let agentInput;
  const runtime = { execute: async value => { agentInput = value; return { mode: 'text', reply: '共 10 张。', toolsUsed: [] }; } };
  const chat = await handleChat(request('/api/chat', 'POST', {
    projectId: project.id, message: '项目有多少卡片？', idempotencyKey: 'chat-one',
    project: '伪造项目', context: '伪造上下文', messages: [{ role: 'user', content: '不要统计' }],
  }, 'employee-b'), { DEEPSEEK_API_KEY: 'test', PROJECT_TENANT_ID: 'company' }, { auth, repository, runtime });
  assert.equal(chat.status, 200);
  assert.equal((await chat.json()).reply, '共 10 张。');
  assert.equal(agentInput.project, '团队进度');
  assert.equal(agentInput.context, '项目目标：统计卡片。');
  assert.equal(agentInput.messages.at(-1).content, '项目有多少卡片？');
  assert.deepEqual((await repository.get(project.id)).messages.map(item => item.content), ['项目有多少卡片？', '共 10 张。']);

  const replay = await handleChat(request('/api/chat', 'POST', { projectId: project.id, message: '项目有多少卡片？', idempotencyKey: 'chat-one' }, 'employee-b'),
    { DEEPSEEK_API_KEY: 'test' }, { auth, repository, runtime: { execute: () => assert.fail('replay must skip Agent') } });
  assert.equal((await replay.json()).replayed, true);
  assert.equal((await repository.get(project.id)).messages.length, 2);
  const conflictingReplay = await handleChat(request('/api/chat', 'POST', { projectId: project.id, message: '换一个问题', idempotencyKey: 'chat-one' }, 'employee-b'),
    { DEEPSEEK_API_KEY: 'test' }, { auth, repository, runtime: { execute: () => assert.fail('conflicting replay must skip Agent') } });
  assert.equal(conflictingReplay.status, 409);
  await assert.rejects(repository.appendExchange(project.id, { message: '换一个问题', reply: '错误', actorId: 'employee-b', idempotencyKey: 'chat-one' }), error => error.code === 'project_request_replayed');
  assert.equal((await handleChat(request('/api/chat', 'POST', { projectId: project.id, message: 'hi', idempotencyKey: 'other' }, null), { DEEPSEEK_API_KEY: 'test' }, { auth, repository, runtime })).status, 401);

  assert.equal((await handleProjects(request(`/api/projects/${project.id}`, 'PATCH', { archived: true }), { auth, repository })).status, 200);
  assert.equal((await handleChat(request('/api/chat', 'POST', { projectId: project.id, message: 'hi', idempotencyKey: 'archived' }), { DEEPSEEK_API_KEY: 'test' }, { auth, repository, runtime })).status, 409);
  assert.equal((await handleProjects(request(`/api/projects/${project.id}`, 'PATCH', { archived: false }), { auth, repository })).status, 200);
  assert.equal((await handleProjects(request(`/api/projects/${project.id}/conversation`, 'DELETE', undefined, 'employee-b'), { auth, repository })).status, 200);
  assert.deepEqual((await repository.get(project.id)).messages, []);

  const spoofed = request(`/api/projects/${project.id}`, 'PATCH', { title: '劫持' });
  spoofed.headers.set('origin', 'https://evil.test');
  assert.equal((await handleProjects(spoofed, { auth, repository })).status, 403);
  assert.equal((await handleProjects(request(`/api/projects/${project.id}`, 'DELETE'), { auth, repository })).status, 200);
  assert.equal((await handleProjects(request(`/api/projects/${project.id}`, 'GET', undefined, 'employee-b'), { auth, repository })).status, 404);
});
