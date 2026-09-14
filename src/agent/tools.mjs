export class AgentToolError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const projectHttpTool = {
  name: 'project_http_request',
  description: '按照当前项目上下文中的接入说明发起真实服务器端 HTTP 请求。只能访问上下文明确列出的 HTTPS 地址及其子路径。允许 GET、登录 POST .../auth，以及受控 change-set 写入：POST .../change-sets 和 POST .../change-sets/:id/commit；commit 必须带 Idempotency-Key。禁止直接 PATCH/PUT/DELETE。上下文中的 {{PROJECT_SECRET_n}} 可原样放入请求，宿主会代入真实值。',
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
const MAX_TOOL_ARGUMENTS = 120000;

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (JSON.stringify(value).length > MAX_TOOL_ARGUMENTS) throw new AgentToolError('tool_arguments_invalid', 422);
    return value;
  }
  if (typeof value !== 'string' || value.length > MAX_TOOL_ARGUMENTS) throw new AgentToolError('tool_arguments_invalid', 422);
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

function postKind(url) {
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/auth$/i.test(path)) return 'auth';
  if (/\/api\/boards\/[^/]+\/change-sets$/i.test(path)) return 'change-set';
  if (/\/api\/boards\/[^/]+\/change-sets\/[^/]+\/commit$/i.test(path)) return 'commit';
  return null;
}

function validateChangeSetBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isInteger(value.base_version) || value.base_version < 0
    || typeof value.source !== 'string' || !value.source.trim() || value.source.length > 128
    || typeof value.actor !== 'string' || !value.actor.trim() || value.actor.length > 128
    || !Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 200
    || value.operations.some(operation => !operation || typeof operation !== 'object' || Array.isArray(operation))) {
    throw new AgentToolError('project_http_write_invalid', 422);
  }
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

export function createProjectHttpExecutor({ config, fetcher = fetch, signal }) {
  const vault = new Map(config.secrets.map(item => [item.placeholder, item.value]));
  let secretIndex = vault.size;
  const nextPlaceholder = () => `{{PROJECT_SECRET_${++secretIndex}}}`;
  return async call => {
    const input = parseArguments(call.input);
    const method = String(input.method || '').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new AgentToolError('project_http_method_not_allowed', 422);
    const url = validateHttpTarget(input.url, config.allowedPrefixes);
    const writeKind = method === 'POST' ? postKind(url) : null;
    if (method === 'POST' && !writeKind) throw new AgentToolError('project_http_method_not_allowed', 422);
    const headers = requestHeaders(input.headers, vault);
    if (writeKind === 'change-set') validateChangeSetBody(input.body);
    if (writeKind === 'commit' && !Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'idempotency-key' && value.trim())) {
      throw new AgentToolError('project_http_idempotency_required', 422);
    }
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
