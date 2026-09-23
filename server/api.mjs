import { validProjectKey } from '../src/agent/intent.mjs';
import { AgentRunError, runAgent } from '../src/agent/run.mjs';
import { createSitesSnapshotStore, StoreError } from '../src/platform/store.mjs';
import { compileProjectContextRuntime } from '../src/platform/context-runtime.mjs';

const limits = new Map();
const MAX_BODY = 100000;

export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validText(value, max) { return typeof value === 'string' && value.length <= max; }

function errorMessage(code) {
  return ({
    not_configured: '序言尚未配置模型连接，请联系管理员。',
    provider_auth: '模型连接认证失败，请联系管理员检查密钥。',
    provider_balance: '模型账户余额不足，请联系管理员充值。',
    provider_busy: '模型服务繁忙，请稍后重试。',
    provider_unavailable: '模型服务暂时不可用，请稍后重试。',
    network_error: '暂时无法连接模型服务，请稍后重试。',
    timeout: '回复超时，请稍后重试。',
    invalid_reply: '模型没有返回有效回复，请重试。',
    agent_runtime_unavailable: 'Agent Runtime 尚未安装或没有接入当前服务。',
    agent_runtime_failed: 'Agent Runtime 本轮执行失败，请稍后重试。',
    agent_runtime_invalid_result: 'Agent Runtime 没有提交有效结果，请重试。',
    agent_runtime_output_too_large: 'Agent Runtime 返回内容过大，本轮已停止。',
    snapshot_not_submitted: 'Agent Runtime 没有按要求提交快照候选。',
    storage_unavailable: '快照存储尚未配置，当前只能使用文本回复。',
    storage_failed: '快照写入失败，本次结果未提交，请稍后重试。',
    storage_verification_failed: '快照写入后校验失败，本次结果未提交。',
    snapshot_conflict: '快照提交发生冲突，请重新发起生成。',
    candidate_validation_failed: '生成的快照未通过安全校验，请调整要求后重试。',
    draft_json_invalid: '生成的快照格式无效，请调整要求后重试。',
    project_not_found: '当前项目不存在或尚未配置。',
    project_config_invalid: '服务端项目配置无效，请联系管理员。',
    timeline_not_configured: 'Timeline 数据源尚未配置凭据，请联系管理员。',
    timeline_unauthorized: 'Timeline 登录已失效，请重试。',
    timeline_forbidden: 'Timeline 凭据无效或当前看板拒绝访问。',
    timeline_not_found: 'Timeline 看板或资源不存在。',
    timeline_rate_limited: 'Timeline 请求过多，请稍后重试。',
    timeline_timeout: 'Timeline 取数超时，请稍后重试。',
    timeline_network_error: '暂时无法连接 Timeline，请稍后重试。',
    timeline_protocol_unsupported: 'Timeline 协议版本暂不支持。',
    timeline_protocol_changed: 'Timeline 协议在取数期间发生变化，请重试。',
    timeline_read_unsupported: '当前 Timeline 实例未开放只读取数能力。',
    timeline_result_too_large: 'Timeline 返回数据过大，暂时无法生成快照。',
    timeline_unavailable: 'Timeline 服务暂时不可用，请稍后重试。',
    tool_arguments_invalid: '模型生成的 Timeline 查询条件无效，请重试。',
    project_http_url_invalid: '模型生成的数据源地址无效，请重试。',
    project_http_target_not_allowed: '模型尝试访问项目上下文范围之外的地址，已阻止。',
    project_http_method_not_allowed: '当前只开放项目数据读取、登录和受控 change-set 写入。',
    project_http_write_invalid: 'Agent 生成的 change-set 缺少有效的版本、来源、操作者或操作列表。',
    project_http_idempotency_required: '提交 change-set 必须携带有效的 Idempotency-Key。',
    project_http_header_not_allowed: '模型生成了不允许的数据源请求头，已阻止。',
    project_http_network_error: '暂时无法连接项目数据源，请稍后重试。',
    project_http_result_too_large: '项目数据源返回内容过大，无法在本轮处理。',
  })[code] || '快照生成失败，请稍后重试。';
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function inlinePackage(candidate) {
  return {
    manifest: bytesToBase64(candidate.bytes),
    resources: candidate.manifest.resources.map(resource => ({ id: resource.id, bytes: bytesToBase64(candidate.files.get(resource.path)) })),
  };
}

function acquireLimit(user) {
  const now = Date.now();
  for (const [id, item] of limits) if (now - item.start >= 60000 && !item.active) limits.delete(id);
  let limit = limits.get(user);
  if (!limit) { limit = { start: now, count: 0, active: 0 }; limits.set(user, limit); }
  if (now - limit.start >= 60000) { limit.start = now; limit.count = 0; }
  if (limit.count >= 20 || limit.active >= 2) return null;
  limit.count++;
  limit.active++;
  return limit;
}

export async function handleChat(request, env, { auth = null, identity = null, runtime = null, store, now = () => new Date(), idFactory = () => crypto.randomUUID(), onProgress = null } = {}) {
  if (request.method !== 'POST') return json({ error: '请使用 POST 请求。' }, 405);
  const authenticated = identity || (auth ? await auth.identity(request) : null);
  const user = authenticated?.id;
  if (!user) return json({ error: '请先登录后使用序言。' }, 401);
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '不允许跨站调用。' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ error: '请求必须为 JSON。' }, 415);
  let body;
  try { body = await readBody(request); }
  catch (error) { return json({ error: error.message === 'large' ? '消息过长，请缩短后重试。' : '请求格式不正确。' }, error.message === 'large' ? 413 : 400); }
  const { project: submittedProject, projectKey, context: submittedContext, messages, responseMode = 'auto', idempotencyKey } = body || {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || !validText(message.content, 6000) || !message.content.trim()) || messages.at(-1).role !== 'user' || !['auto', 'text', 'snapshot'].includes(responseMode)) return json({ error: '消息或项目上下文格式不正确。' }, 400);
  const project = submittedProject;
  const context = submittedContext;
  if (!validText(project, 80) || !project.trim() || !validText(context, 10000)) return json({ error: '消息或项目上下文格式不正确。' }, 400);
  const contextRuntime = compileProjectContextRuntime(context);
  const safeContext = contextRuntime.safeContext;
  const agentProjectConfig = contextRuntime.http
    ? { http: contextRuntime.http, policyVersion: 'user-context-v1' }
    : null;
  if (!validProjectKey(projectKey) || !validText(idempotencyKey, 128) || !idempotencyKey.trim()) return json({ error: '请求缺少有效的项目或幂等标识。' }, 400);
  const limit = acquireLimit(user);
  if (!limit) return json({ error: '请求较多，请稍后重试。' }, 429);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, responseMode === 'text' ? 90000 : 180000);
  try {
    onProgress?.({ phase: 'accepted' });
    const createdAt = now().toISOString();
    const runId = `run-${idFactory()}`;
    const snapshotStore = store || env.SNAPSHOT_STORE || (env.DB && env.BUCKET ? createSitesSnapshotStore(env) : null);
    let started = null;
    if (responseMode === 'snapshot' && snapshotStore) {
      started = await snapshotStore.startRun({ runId, actorId: user, projectKey, idempotencyKey, requestedMode: responseMode, modelConfigVersion: 'deepseek-claude-runtime-v1', contractVersion: 'p2-1', createdAt });
      if (!started.created) {
        if (started.run.status === 'committed') {
          const record = await snapshotStore.getRecord({ actorId: user, projectKey, snapshotId: started.run.snapshotId });
          if (!record) throw new StoreError('snapshot_not_found', 404);
          return json({ reply: started.run.reply, runId: started.run.runId, snapshotStatus: 'generated', snapshotRef: { snapshotId: record.snapshotId, manifestHash: record.manifestHash }, scope: { tenantId: user, projectId: projectKey }, title: record.title, messageId: record.messageId, truncated: false });
        }
        return json({ error: started.run.status === 'staging' ? '相同请求正在生成，请稍后重试。' : errorMessage(started.run.errorCode), runId: started.run.runId }, started.run.status === 'staging' ? 409 : 422);
      }
    }
    let result;
    try {
      result = await runAgent({ env, project, projectKey, context: safeContext, messages, requestedMode: responseMode, actorId: user, projectConfig: agentProjectConfig, runtime, signal: controller.signal, onProgress, now, idFactory });
    } catch (error) {
      if (started?.created) await snapshotStore.failRun({ runId, actorId: user, projectKey, errorCode: error.code || 'agent_runtime_failed', repairCount: error.repairCount || 0, finishedAt: now().toISOString() });
      throw error;
    }
    if (result.mode === 'text') {
      return json({ reply: result.reply, runId, agentRun: result.runtime, truncated: result.truncated });
    }
    if (!snapshotStore) {
      const messageId = `msg-${idFactory()}`;
      const generation = result.candidate.manifest.extensions['com.xuyan.generation'];
      return json({
        reply: result.reply,
        runId,
        snapshotStatus: 'generated',
        snapshotPersistence: 'session',
        snapshotRef: result.candidate.ref,
        snapshotPackage: inlinePackage(result.candidate),
        scope: { tenantId: user, projectId: projectKey },
        sourceKind: generation.sourceKind,
        source: generation.source,
        title: result.candidate.title,
        messageId,
        agentRun: result.runtime,
        truncated: result.truncated,
      });
    }
    if (!started) {
      started = await snapshotStore.startRun({ runId, actorId: user, projectKey, idempotencyKey, requestedMode: responseMode, modelConfigVersion: 'deepseek-claude-runtime-v1', contractVersion: 'p2-1', createdAt });
      if (!started.created) {
        if (started.run.status === 'committed') {
          const record = await snapshotStore.getRecord({ actorId: user, projectKey, snapshotId: started.run.snapshotId });
          if (!record) throw new StoreError('snapshot_not_found', 404);
          return json({ reply: started.run.reply, runId: started.run.runId, snapshotStatus: 'generated', snapshotRef: { snapshotId: record.snapshotId, manifestHash: record.manifestHash }, scope: { tenantId: user, projectId: projectKey }, title: record.title, messageId: record.messageId, truncated: false });
        }
        return json({ error: started.run.status === 'staging' ? '相同请求正在生成，请稍后重试。' : errorMessage(started.run.errorCode), runId: started.run.runId }, started.run.status === 'staging' ? 409 : 422);
      }
    }
    const committedAt = now().toISOString();
    const messageId = `msg-${idFactory()}`;
    let committed;
    try {
      committed = await snapshotStore.commitCandidate({ runId, messageId, actorId: user, projectKey, candidate: result.candidate, reply: result.reply, model: result.model, repairCount: result.attempt, committedAt });
    } catch (error) {
      const code = error.code || 'storage_failed';
      await snapshotStore.failRun({ runId, actorId: user, projectKey, errorCode: code, model: result.model, repairCount: result.attempt, finishedAt: now().toISOString() });
      if (error instanceof StoreError) throw error;
      throw new StoreError(code, 503);
    }
    return json({ reply: result.reply, runId, snapshotStatus: 'generated', snapshotPersistence: 'stored', snapshotRef: { snapshotId: committed.snapshotId, manifestHash: committed.manifestHash }, scope: { tenantId: user, projectId: projectKey }, sourceKind: committed.sourceKind, title: committed.title, messageId, agentRun: result.runtime, truncated: result.truncated });
  } catch (error) {
    if (error instanceof AgentRunError || error instanceof StoreError) return json({ error: errorMessage(error.code), errorCode: error.code }, error.status || 502);
    return json({ error: controller.signal.aborted ? errorMessage('timeout') : errorMessage('provider_unavailable') }, controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    limit.active--;
  }
}

const PROGRESS_PHASES = new Set(['accepted', 'runtime_ready', 'tool_started', 'tool_finished', 'validating_snapshot']);
const PROGRESS_TOOLS = new Set(['WebSearch', 'project_http_request', 'submit_snapshot']);
const PROGRESS_ACTIONS = new Set(['read', 'auth', 'change_set', 'commit']);
const PROGRESS_OUTCOMES = new Set(['succeeded', 'failed', 'returned']);

function publicProgress(event) {
  if (!PROGRESS_PHASES.has(event?.phase)) return null;
  if (!event.phase.startsWith('tool_')) return { phase: event.phase };
  if (!PROGRESS_TOOLS.has(event.tool) || !Number.isInteger(event.step) || event.step < 1 || event.step > 1000) return null;
  const value = { phase: event.phase, tool: event.tool, step: event.step };
  if (event.tool === 'project_http_request') {
    if (Number.isInteger(event.source) && event.source >= 1 && event.source <= 12) value.source = event.source;
    if (PROGRESS_ACTIONS.has(event.action)) value.action = event.action;
  }
  if (event.phase === 'tool_finished') {
    value.outcome = PROGRESS_OUTCOMES.has(event.outcome) ? event.outcome : 'returned';
    if (event.tool === 'project_http_request' && Number.isInteger(event.status) && event.status >= 100 && event.status <= 599) value.status = event.status;
    if (Number.isInteger(event.durationMs) && event.durationMs >= 0 && event.durationMs <= 1800000) value.durationMs = event.durationMs;
  }
  return value;
}

export function handleChatStream(request, env, dependencies = {}) {
  const encoder = new TextEncoder();
  const aborter = new AbortController();
  const signal = AbortSignal.any([request.signal, aborter.signal]);
  const runningRequest = new Request(request, { signal });
  let heartbeat;
  let closed = false;
  const body = new ReadableStream({
    start(controller) {
      const send = (type, value) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)); }
        catch { closed = true; aborter.abort(); }
      };
      heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(': keep-alive\n\n')); }
          catch { closed = true; aborter.abort(); }
        }
      }, 15000);
      const onProgress = event => {
        const value = publicProgress(event);
        if (value) send('progress', value);
      };
      void (async () => {
        try {
          const response = await handleChat(runningRequest, env, { ...dependencies, onProgress });
          send('result', { status: response.status, body: await response.json() });
        } catch {
          send('result', { status: 502, body: { error: '服务暂不可用，请稍后重试。' } });
        } finally {
          clearInterval(heartbeat);
          if (!closed) { closed = true; controller.close(); }
        }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); aborter.abort(); },
  });
  return new Response(body, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  } });
}
