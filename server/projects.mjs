import { json } from './api.mjs';
import { hasConfiguredProjects, ProjectConfigError, publicProjects } from '../src/platform/projects.mjs';

export function actorForProjectRequest(request, env) {
  return env.XUYAN_LOCAL ? 'local' : request.headers.get('oai-authenticated-user-id');
}

export async function handleProjectsRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const actorId = actorForProjectRequest(request, env);
  if (!actorId) return json({ error: '请先登录后访问项目。' }, 401);
  try {
    const projects = publicProjects(env, actorId);
    return json({ configured: hasConfiguredProjects(env), projects });
  } catch (error) {
    if (error instanceof ProjectConfigError) return json({ error: '项目配置无效。', errorCode: error.code }, error.status);
    return json({ error: '项目配置不可用。' }, 500);
  }
}
