const projectKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const credentialPattern = /^TIMELINE_[A-Z0-9_]*PASSWORD$/;

export class ProjectConfigError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
}

function timelineSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProjectConfigError('project_source_invalid');
  if (Object.keys(value).some(key => !['type', 'baseUrl', 'boardId', 'credentialEnv'].includes(key))) throw new ProjectConfigError('project_source_invalid');
  if (value.type !== 'timeline') throw new ProjectConfigError('project_source_unsupported');
  const baseUrlText = text(value.baseUrl, 500);
  const boardId = text(value.boardId, 128);
  const credentialEnv = value.credentialEnv === undefined ? 'TIMELINE_TEST_BOARD_PASSWORD' : text(value.credentialEnv, 128);
  if (!baseUrlText || !boardId || !credentialEnv || !credentialPattern.test(credentialEnv)) throw new ProjectConfigError('project_source_invalid');
  let baseUrl;
  try { baseUrl = new URL(baseUrlText); }
  catch { throw new ProjectConfigError('project_source_invalid'); }
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new ProjectConfigError('project_source_invalid');
  return { type: 'timeline', baseUrl: baseUrl.href.replace(/\/$/, ''), boardId, credentialEnv };
}

export function readProjectRegistry(env) {
  const raw = env?.XUYAN_PROJECTS_JSON;
  if (!raw) return [];
  if (typeof raw !== 'string' || raw.length > 50000) throw new ProjectConfigError('project_config_invalid');
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new ProjectConfigError('project_config_invalid'); }
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new ProjectConfigError('project_config_invalid');
  const keys = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['key', 'title', 'context', 'actorIds', 'source'].includes(key))) throw new ProjectConfigError('project_config_invalid');
    const key = text(item.key, 64);
    const title = text(item.title, 80);
    const context = typeof item.context === 'string' && item.context.length <= 10000 ? item.context.trim() : null;
    if (!key || !projectKeyPattern.test(key) || keys.has(key) || !title || context === null || !Array.isArray(item.actorIds) || item.actorIds.length < 1 || item.actorIds.length > 100 || item.actorIds.some(id => !text(id, 128))) throw new ProjectConfigError('project_config_invalid');
    keys.add(key);
    return Object.freeze({ key, title, context, actorIds: Object.freeze([...new Set(item.actorIds.map(id => id.trim()))]), source: timelineSource(item.source) });
  });
}

export function resolveProject(env, projectKey, actorId) {
  const projects = readProjectRegistry(env);
  if (!projects.length) return null;
  const project = projects.find(item => item.key === projectKey);
  if (!project || (!env.XUYAN_LOCAL && !project.actorIds.includes(actorId))) throw new ProjectConfigError('project_not_found', 404);
  return project;
}

export function publicProjects(env, actorId) {
  return readProjectRegistry(env).filter(project => env.XUYAN_LOCAL || project.actorIds.includes(actorId)).map(({ key, title, context, source }) => ({
    key,
    title,
    context,
    source: { type: source.type, boardId: source.boardId },
  }));
}

export function hasConfiguredProjects(env) {
  return readProjectRegistry(env).length > 0;
}
