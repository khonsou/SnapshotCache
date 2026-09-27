import { ProjectRepositoryError } from './project-repository.mjs';
import { json, projectRunActive } from './api.mjs';

const MAX_BODY = 20000;

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return (!origin || origin === new URL(request.url).origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function readJSON(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new ProjectRepositoryError('project_request_invalid', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ProjectRepositoryError('project_request_invalid', 400);
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); throw new ProjectRepositoryError('project_request_invalid', 413); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(text);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('shape');
    return data;
  } catch { throw new ProjectRepositoryError('project_request_invalid', 400); }
}

const publicError = {
  project_not_found: '项目不存在。',
  project_title_invalid: '请输入不超过 40 个字符的项目名称。',
  project_title_exists: '这个项目名称已存在。',
  project_context_invalid: '项目上下文最多 10,000 个字符。',
  project_request_invalid: '请求格式不正确。',
  project_update_invalid: '项目修改内容不正确。',
};

export async function handleProjects(request, { auth, repository } = {}) {
  const identity = await auth?.identity(request);
  if (!identity?.id) return json({ error: '请先登录后使用序言。' }, 401);
  if (!repository) return json({ error: '项目存储尚未配置。' }, 503);
  if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) return json({ error: '不允许跨站调用。' }, 403);
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api' || segments[1] !== 'projects' || segments.length > 4) return json({ error: '项目不存在。' }, 404);
  const id = segments[2];
  try {
    if (segments.length === 2) {
      if (request.method === 'GET') return json({ projects: await repository.list() });
      if (request.method === 'POST') {
        const body = await readJSON(request);
        if (Object.keys(body).some(key => key !== 'title')) throw new ProjectRepositoryError('project_request_invalid', 400);
        return json({ project: await repository.create({ title: body.title, actorId: identity.id, actorName: identity.name }) }, 201);
      }
      return json({ error: '不支持此项目操作。' }, 405);
    }
    if (segments.length === 3) {
      if (request.method === 'GET') return json({ project: await repository.get(id) });
      if (projectRunActive(id)) return json({ error: '项目正在处理消息，请完成后再修改或删除。' }, 409);
      if (request.method === 'PATCH') {
        const body = await readJSON(request);
        if (!Object.keys(body).length || Object.keys(body).some(key => !['title', 'archived', 'context'].includes(key))) throw new ProjectRepositoryError('project_update_invalid', 400);
        return json({ project: await repository.update(id, body, identity.id) });
      }
      if (request.method === 'DELETE') { await repository.remove(id); return json({ deleted: true }); }
      return json({ error: '不支持此项目操作。' }, 405);
    }
    if (segments.length === 4 && segments[3] === 'conversation' && request.method === 'DELETE') {
      if (projectRunActive(id)) return json({ error: '项目正在处理消息，请完成后再开启新对话。' }, 409);
      return json({ project: await repository.clearConversation(id, identity.id) });
    }
    return json({ error: '项目不存在。' }, 404);
  } catch (error) {
    if (error instanceof ProjectRepositoryError) return json({ error: publicError[error.code] || '项目存储暂时不可用。', errorCode: error.code }, error.status);
    return json({ error: '项目存储暂时不可用。' }, 503);
  }
}
