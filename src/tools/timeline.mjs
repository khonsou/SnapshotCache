const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 20;

export class TimelineError extends Error {
  constructor(code, status = 502, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

function apiUrl(baseUrl, path, search) {
  const url = new URL(baseUrl.replace(/\/$/, '') + path);
  if (search) for (const [key, value] of Object.entries(search)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  return url.href;
}

async function readText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TimelineError('timeline_response_too_large', 502); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function request(fetcher, url, options = {}) {
  let response;
  try { response = await fetcher(url, { redirect: 'error', cache: 'no-store', ...options }); }
  catch (error) {
    if (options.signal?.aborted) throw new TimelineError('timeline_timeout', 504);
    throw new TimelineError('timeline_network_error', 502);
  }
  const protocolVersion = response.headers.get('x-protocol-version');
  const body = await readText(response);
  let payload = null;
  if (body) {
    try { payload = JSON.parse(body); }
    catch { if (response.ok) throw new TimelineError('timeline_invalid_response', 502); }
  }
  if (!response.ok) {
    const retryAfter = payload?.retry_after ?? response.headers.get('retry-after') ?? undefined;
    const code = response.status === 401 ? 'timeline_unauthorized'
      : response.status === 403 ? 'timeline_forbidden'
        : response.status === 404 ? 'timeline_not_found'
          : response.status === 429 ? 'timeline_rate_limited'
            : response.status >= 500 ? 'timeline_unavailable' : 'timeline_request_failed';
    throw new TimelineError(code, response.status, { retryAfter });
  }
  return { payload, protocolVersion, headers: response.headers };
}

function validateMeta(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.protocol_version !== 'string' || !Array.isArray(payload.capabilities)) throw new TimelineError('timeline_meta_invalid');
  const [major, minor] = payload.protocol_version.split('.').map(Number);
  if (major !== 19 || !Number.isInteger(minor) || minor < 1) throw new TimelineError('timeline_protocol_unsupported', 502, { protocolVersion: payload.protocol_version });
  if (!payload.capabilities.includes('items.read')) throw new TimelineError('timeline_read_unsupported');
  return payload;
}

function arrayFrom(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  if (payload && payload.data && Array.isArray(payload.data[key])) return payload.data[key];
  throw new TimelineError('timeline_invalid_response');
}

function revisionFrom(payload, headers) {
  const value = payload?.board_version ?? payload?.version ?? headers.get('etag');
  return value === undefined || value === null ? null : String(value);
}

export function createTimelineClient({ baseUrl, boardId, password, fetcher = fetch, signal, now = () => new Date() }) {
  if (typeof baseUrl !== 'string' || typeof boardId !== 'string' || typeof password !== 'string' || !password) throw new TimelineError('timeline_not_configured', 503);
  let token = null;
  let meta = null;

  async function discover() {
    const result = await request(fetcher, apiUrl(baseUrl, '/api/meta'), { signal });
    meta = validateMeta(result.payload);
    if (result.protocolVersion && result.protocolVersion !== meta.protocol_version) throw new TimelineError('timeline_protocol_mismatch');
    return meta;
  }

  async function authenticate() {
    const result = await request(fetcher, apiUrl(baseUrl, `/api/boards/${encodeURIComponent(boardId)}/auth`), {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const value = result.payload?.token ?? result.payload?.access_token;
    if (typeof value !== 'string' || !value || value.length > 4096) throw new TimelineError('timeline_auth_invalid');
    token = value;
    return token;
  }

  async function authorized(path, search, retry = true) {
    if (!token) await authenticate();
    try {
      const result = await request(fetcher, apiUrl(baseUrl, path, search), { signal, headers: { Authorization: `Bearer ${token}` } });
      if (result.protocolVersion && meta && result.protocolVersion !== meta.protocol_version) throw new TimelineError('timeline_protocol_changed');
      return result;
    } catch (error) {
      if (retry && error instanceof TimelineError && error.code === 'timeline_unauthorized') {
        token = null;
        await authenticate();
        return authorized(path, search, false);
      }
      throw error;
    }
  }

  async function readCollection(name, search) {
    const collected = [];
    let cursor;
    let revision = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await authorized(`/api/boards/${encodeURIComponent(boardId)}/${name}`, { ...search, ...(cursor ? { cursor } : {}) });
      const values = arrayFrom(result.payload, name);
      collected.push(...values);
      revision ??= revisionFrom(result.payload, result.headers);
      cursor = result.payload?.next_cursor ?? result.payload?.nextCursor ?? null;
      if (!cursor) return { values: collected, revision };
    }
    throw new TimelineError('timeline_pagination_limit');
  }

  return {
    async discover() { return discover(); },
    async readBoard(filters = {}) {
      const allowed = new Set(['date', 'product_id', 'member', 'status', 'q']);
      if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => !allowed.has(key))) throw new TimelineError('timeline_tool_arguments_invalid', 400);
      for (const value of Object.values(filters)) if (value !== undefined && (typeof value !== 'string' || value.length > 200)) throw new TimelineError('timeline_tool_arguments_invalid', 400);
      const currentMeta = meta || await discover();
      if (filters.status && Array.isArray(currentMeta.enums?.status) && !currentMeta.enums.status.includes(filters.status)) throw new TimelineError('timeline_tool_arguments_invalid', 400);
      const items = await readCollection('items', filters);
      const products = await readCollection('products');
      const members = await readCollection('members');
      const observedAt = now().toISOString();
      const revision = items.revision ?? products.revision ?? members.revision;
      return {
        source: { sourceId: `timeline.${boardId}`, revision, observedAt, protocolVersion: currentMeta.protocol_version, boardId },
        capabilities: currentMeta.capabilities,
        features: currentMeta.features || {},
        enums: currentMeta.enums || {},
        items: items.values,
        products: products.values,
        members: members.values,
      };
    },
  };
}
