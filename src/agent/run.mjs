import { callModel, ModelError } from './model.mjs';
import { textSystemPrompt, snapshotSystemPrompt, toolSelectionSystemPrompt } from './prompt.mjs';
import { decideResponseMode, shouldReadProjectSource } from './intent.mjs';
import { buildQueryContext, buildSnapshotCandidate, parseSnapshotDraft } from './draft.mjs';
import { AgentToolError, createProjectToolset } from './tools.mjs';

export class AgentRunError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const safeRepairCode = error => /^draft_[a-z_]+$/.test(error?.code || '') ? error.code : 'candidate_validation_failed';

export async function runAgent({ env, project, projectKey, context, messages, requestedMode = 'auto', actorId, projectConfig = null, fetcher = fetch, signal, now = () => new Date(), idFactory = () => crypto.randomUUID() }) {
  const text = messages.at(-1).content;
  const sourceType = projectConfig?.source?.type || null;
  const mode = decideResponseMode(text, requestedMode, { sourceType });
  if (mode === 'text') {
    try {
      const result = await callModel({ env, messages, system: textSystemPrompt(project, context), fetcher, signal, maxTokens: 1500 });
      return { mode, reply: result.content, truncated: result.truncated, model: result.model, usage: result.usage };
    } catch (error) {
      if (error instanceof ModelError) throw new AgentRunError(error.code, error.status);
      throw error;
    }
  }

  const createdAt = now().toISOString();
  const scope = { tenantId: actorId, projectId: projectKey };
  let source = null;
  let generationMessages = messages;
  let toolset;
  try { toolset = shouldReadProjectSource(text, sourceType) ? createProjectToolset({ env, projectConfig, fetcher, signal, now }) : null; }
  catch (error) {
    if (error instanceof AgentToolError) throw new AgentRunError(error.code, error.status);
    throw error;
  }
  if (toolset) {
    let selection;
    try {
      selection = await callModel({
        env,
        messages,
        system: toolSelectionSystemPrompt(project, context),
        fetcher,
        signal,
        maxTokens: 1000,
        tools: toolset.definitions,
        toolChoice: 'required',
      });
      if (selection.toolCalls.length !== 1) throw new AgentToolError('tool_call_required', 422);
      const toolResult = await toolset.execute(selection.toolCalls[0]);
      source = toolResult.source;
      const toolContent = JSON.stringify(toolResult.data);
      if (toolContent.length > 1500000) throw new AgentToolError('timeline_result_too_large', 502);
      generationMessages = [...messages,
        { role: 'assistant', content: selection.content, tool_calls: selection.toolCalls },
        { role: 'tool', tool_call_id: selection.toolCalls[0].id, content: toolContent },
      ];
    } catch (error) {
      if (error instanceof ModelError || error instanceof AgentToolError) throw new AgentRunError(error.code, error.status);
      throw error;
    }
  }
  let repairCodes = [];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await callModel({
        env,
        messages: generationMessages,
        system: snapshotSystemPrompt(project, context, repairCodes, source),
        fetcher,
        signal,
        maxTokens: Number(env.DEEPSEEK_SNAPSHOT_MAX_TOKENS || 7000),
      });
    } catch (error) {
      if (error instanceof ModelError) throw new AgentRunError(error.code, error.status);
      throw error;
    }
    try {
      const draft = parseSnapshotDraft(result.content);
      const query = await buildQueryContext({ scope, project, context, text, createdAt, requestedMode, source, policyVersion: projectConfig?.policyVersion || (projectConfig ? 'configured-project-v1' : 'p2-owner-scope-v1') });
      const candidate = await buildSnapshotCandidate({ draft, snapshotId: `gen-${idFactory()}`, scope, createdAt, query, model: result.model, source });
      return { mode, reply: draft.reply, truncated: result.truncated, model: result.model, usage: result.usage, attempt, candidate };
    } catch (error) {
      lastError = error;
      repairCodes = [safeRepairCode(error)];
    }
  }
  const failure = new AgentRunError(safeRepairCode(lastError), 422);
  failure.repairCount = 1;
  throw failure;
}
