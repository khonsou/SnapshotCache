import { buildQueryContext, buildSnapshotCandidate, parseSnapshotDraft } from './draft.mjs';

export class AgentRunError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const safeDraftCode = error => /^draft_[a-z_]+$/.test(error?.code || '') ? error.code : 'candidate_validation_failed';

export async function runAgent({
  env,
  project,
  projectKey,
  context,
  messages,
  requestedMode = 'auto',
  actorId,
  projectConfig = null,
  runtime,
  signal,
  now = () => new Date(),
  idFactory = () => crypto.randomUUID(),
}) {
  if (!runtime || typeof runtime.execute !== 'function') throw new AgentRunError('agent_runtime_unavailable', 503);
  let execution;
  try {
    execution = await runtime.execute({ env, project, context, messages, requestedMode, projectConfig, signal });
  } catch (error) {
    if (error?.code && typeof error?.status === 'number') throw new AgentRunError(error.code, error.status);
    throw new AgentRunError(signal?.aborted ? 'timeout' : 'agent_runtime_failed', signal?.aborted ? 504 : 502);
  }
  if (!execution || !['text', 'snapshot'].includes(execution.mode) || typeof execution.reply !== 'string' || !execution.reply.trim()) {
    throw new AgentRunError('agent_runtime_invalid_result', 502);
  }
  if ((requestedMode === 'text' && execution.mode !== 'text') || (requestedMode === 'snapshot' && execution.mode !== 'snapshot')) {
    throw new AgentRunError('agent_runtime_invalid_result', 502);
  }
  const runtimeInfo = {
    name: execution.runtime || 'claude-code',
    provider: 'deepseek',
    model: execution.model || env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    sessionId: typeof execution.sessionId === 'string' ? execution.sessionId : null,
    turns: Number.isInteger(execution.turns) ? execution.turns : null,
    toolsUsed: Array.isArray(execution.toolsUsed) ? execution.toolsUsed.filter(name => typeof name === 'string').slice(0, 32) : [],
  };
  if (execution.mode === 'text') {
    return {
      mode: 'text',
      reply: execution.reply.trim(),
      truncated: Boolean(execution.truncated),
      model: execution.model || env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      usage: execution.usage || null,
      runtime: runtimeInfo,
    };
  }

  const createdAt = now().toISOString();
  const scope = { tenantId: actorId, projectId: projectKey };
  try {
    const draft = parseSnapshotDraft(JSON.stringify(execution.snapshotDraft));
    const source = execution.source || null;
    const query = await buildQueryContext({
      scope,
      project,
      context,
      text: messages.at(-1).content,
      createdAt,
      requestedMode,
      source,
      policyVersion: projectConfig?.policyVersion || (projectConfig ? 'configured-project-v1' : 'p2-owner-scope-v1'),
    });
    const candidate = await buildSnapshotCandidate({
      draft,
      snapshotId: `gen-${idFactory()}`,
      scope,
      createdAt,
      query,
      model: execution.model || env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      source,
    });
    return {
      mode: 'snapshot',
      reply: draft.reply,
      truncated: Boolean(execution.truncated),
      model: execution.model || env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      usage: execution.usage || null,
      attempt: 0,
      candidate,
      runtime: runtimeInfo,
    };
  } catch (error) {
    const failure = new AgentRunError(safeDraftCode(error), 422);
    failure.repairCount = 0;
    throw failure;
  }
}
