import { createTimelineClient, TimelineError } from '../tools/timeline.mjs';

export class AgentToolError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const timelineTool = {
  type: 'function',
  function: {
    name: 'timeline_read_board',
    description: '只读查询当前项目获准的 Timeline 看板，返回卡片、产品、成员、协议能力和来源信息。不得用于写入。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        date: { type: 'string', description: '可选日期过滤，格式以 Timeline 协议为准。' },
        product_id: { type: 'string', description: '可选产品 ID。' },
        member: { type: 'string', description: '可选成员 ID。' },
        status: { type: 'string', description: '可选状态。' },
        q: { type: 'string', description: '可选文本查询。' },
      },
    },
  },
};

const anthropicTimelineTool = {
  name: timelineTool.function.name,
  description: timelineTool.function.description,
  input_schema: timelineTool.function.parameters,
};

const projectHttpTool = {
  name: 'project_http_request',
  description: '按照当前项目上下文中的接入说明发起真实服务器端 HTTP 请求。只能访问上下文明确列出的 HTTPS 地址及其子路径；当前阶段允许 GET，以及仅用于登录换取 token 的 POST .../auth。上下文中的 {{PROJECT_SECRET_n}} 可原样放入请求，宿主会代入真实值。',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['method', 'url'],
    properties: {
      method: { type: 'string', enum: ['GET', 'POST'] },
      url: { type: 'string', description: '完整 HTTPS URL，必须位于项目上下文列出的地址范围内。' },
      headers: { type: 'object', additionalProperties: { type: 'string' }, description: '可选请求头，例如 Authorization、Accept、Content-Type。' },
      body: { description: 'POST 的可选 JSON 对象或文本正文。' },
    },
  },
};

const REQUEST_HEADERS = new Set(['accept', 'authorization', 'content-type', 'idempotency-key', 'if-match']);
const RESPONSE_HEADERS = ['content-type', 'x-protocol-version', 'retry-after', 'location'];
const SENSITIVE_RESPONSE_KEY = /(?:^|_)(?:access_?token|refresh_?token|token|password|secret|api_?key)(?:$|_)/i;
const MAX_HTTP_BODY = 100000;
const MAX_HTTP_RESPONSE = 1000000;

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (JSON.stringify(value).length > 2000) throw new AgentToolError('tool_arguments_invalid', 422);
    return value;
  }
  if (typeof value !== 'string' || value.length > 2000) throw new AgentToolError('tool_arguments_invalid', 422);
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new AgentToolError('tool_arguments_invalid', 422); }
}

function replaceSecrets(value, vault) {
  if (typeof value === 'string') {
    let replaced = value;
    for (const [placeholder, secret] of vault) replaced = replaced.split(placeholder).join(secret);
    return replaced;
  }
  if (Array.isArray(value)) return value.map(item => replaceSecrets(item, vault));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceSecrets(item, vault)]));
  return value;
}

function redactResponseSecrets(value, vault, nextPlaceholder, key = '') {
  if (typeof value === 'string' && SENSITIVE_RESPONSE_KEY.test(key) && value) {
    const existing = [...vault].find(([, secret]) => secret === value)?.[0];
    if (existing) return existing;
    const placeholder = nextPlaceholder();
    vault.set(placeholder, value);
    return placeholder;
  }
  if (Array.isArray(value)) return value.map(item => redactResponseSecrets(item, vault, nextPlaceholder));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, redactResponseSecrets(item, vault, nextPlaceholder, childKey)]));
  return value;
}

function validateHttpTarget(value, allowedPrefixes) {
  let url;
  try { url = new URL(value); }
  catch { throw new AgentToolError('project_http_url_invalid', 422); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new AgentToolError('project_http_url_invalid', 422);
  const allowed = allowedPrefixes.some(prefix => url.origin === prefix.origin
    && (prefix.pathname === '/' || url.pathname === prefix.pathname || url.pathname.startsWith(`${prefix.pathname}/`)));
  if (!allowed) throw new AgentToolError('project_http_target_not_allowed', 403);
  return url;
}

function requestHeaders(value, vault) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) throw new AgentToolError('tool_arguments_invalid', 422);
  const headers = {};
  for (const [name, rawValue] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (!REQUEST_HEADERS.has(normalized) || typeof rawValue !== 'string' || rawValue.length > 4096 || /[\r\n]/.test(rawValue)) throw new AgentToolError('project_http_header_not_allowed', 422);
    headers[name] = replaceSecrets(rawValue, vault);
  }
  return headers;
}

async function responseBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTTP_RESPONSE) {
      await reader.cancel();
      throw new AgentToolError('project_http_result_too_large', 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function createProjectHttpExecutor({ config, fetcher, signal }) {
  const vault = new Map(config.secrets.map(item => [item.placeholder, item.value]));
  let secretIndex = vault.size;
  const nextPlaceholder = () => `{{PROJECT_SECRET_${++secretIndex}}}`;
  return async call => {
    const input = parseArguments(call.input);
    const method = String(input.method || '').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new AgentToolError('project_http_method_not_allowed', 422);
    const url = validateHttpTarget(input.url, config.allowedPrefixes);
    if (method === 'POST' && !/\/auth\/?$/i.test(url.pathname)) throw new AgentToolError('project_http_method_not_allowed', 422);
    const headers = requestHeaders(input.headers, vault);
    let body;
    if (input.body !== undefined) {
      const resolved = replaceSecrets(input.body, vault);
      if (typeof resolved === 'string') body = resolved;
      else {
        body = JSON.stringify(resolved);
        if (!Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      }
      if (body.length > MAX_HTTP_BODY) throw new AgentToolError('tool_arguments_invalid', 422);
    }
    let response;
    try { response = await fetcher(url.href, { method, headers, body, redirect: 'manual', signal }); }
    catch {
      if (signal?.aborted) throw new AgentToolError('timeout', 504);
      throw new AgentToolError('project_http_network_error', 502);
    }
    const text = await responseBody(response);
    const contentType = response.headers.get('content-type') || '';
    let parsed = text;
    if (/application\/(?:[a-z.+-]*\+)?json/i.test(contentType) && text) {
      try { parsed = JSON.parse(text); }
      catch { parsed = text; }
    }
    const safeBody = redactResponseSecrets(parsed, vault, nextPlaceholder);
    const responseHeaders = {};
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    return { status: response.status, ok: response.ok, headers: responseHeaders, body: safeBody };
  };
}

export function createProjectToolset({ env, projectConfig, fetcher = fetch, signal, now }) {
  const hasTimeline = projectConfig?.source?.type === 'timeline';
  const hasHttp = Boolean(projectConfig?.http);
  if (!hasTimeline && !hasHttp) return null;
  let client = null;
  if (hasTimeline) {
    const password = projectConfig.source.password || env[projectConfig.source.credentialEnv];
    const { password: _password, credentialEnv: _credentialEnv, ...clientSource } = projectConfig.source;
    try { client = createTimelineClient({ ...clientSource, password, fetcher, signal, now }); }
    catch (error) {
      if (error instanceof TimelineError) throw new AgentToolError(error.code, error.status);
      throw error;
    }
  }
  const executeHttp = hasHttp ? createProjectHttpExecutor({ config: projectConfig.http, fetcher, signal }) : null;
  return {
    definitions: hasTimeline ? [timelineTool] : [],
    anthropicDefinitions: hasHttp ? [projectHttpTool] : (hasTimeline ? [anthropicTimelineTool] : []),
    async execute(call) {
      const anthropic = call?.type === 'tool_use';
      const name = anthropic ? call.name : call?.function?.name;
      const input = anthropic ? call.input : call?.function?.arguments;
      if (!call || (call.type !== 'function' && !anthropic)) throw new AgentToolError('tool_not_allowed', 422);
      if (anthropic && name === 'project_http_request' && executeHttp) return { name, data: await executeHttp(call), source: null };
      if (name !== 'timeline_read_board' || !client) throw new AgentToolError('tool_not_allowed', 422);
      try {
        const data = await client.readBoard(parseArguments(input));
        return { name: 'timeline_read_board', data, source: data.source };
      } catch (error) {
        if (error instanceof AgentToolError) throw error;
        if (error instanceof TimelineError) throw new AgentToolError(error.code, error.status);
        throw new AgentToolError('timeline_unavailable');
      }
    },
  };
}
