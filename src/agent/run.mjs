import { callModel, callWebEnabledModel, ModelError } from './model.mjs';
import { textSystemPrompt, snapshotSystemPrompt, toolSelectionSystemPrompt } from './prompt.mjs';
import { decideResponseMode, shouldSearchWeb } from './intent.mjs';
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
const PROJECT_TOOL_DENIAL = /(?:只有.{0,24}(?:网页搜索|web_search)|project_http_request.{0,40}(?:尚未|没有|不可|不能|无法).{0,20}(?:接入|调用|使用|状态)|(?:没有|不具备|无法).{0,35}(?:HTTP|http|看板|项目管理|工具调用).{0,24}(?:工具|接口|请求|能力))/i;

export async function runAgent({ env, project, projectKey, context, messages, requestedMode = 'auto', actorId, projectConfig = null, fetcher = fetch, signal, now = () => new Date(), idFactory = () => crypto.randomUUID() }) {
  const text = messages.at(-1).content;
  const mode = decideResponseMode(text, requestedMode);
  let toolset;
  try { toolset = createProjectToolset({ env, projectConfig, fetcher, signal, now }); }
  catch (error) {
    if (error instanceof AgentToolError) throw new AgentRunError(error.code, error.status);
    throw error;
  }
  if (mode === 'text') {
    try {
      let conversation = messages;
      const tools = toolset?.anthropicDefinitions || [];
      const toolNames = tools.map(tool => tool.name);
      let toolExecutions = 0;
      let forcedTool = null;
      for (let round = 0; round < 10; round++) {
        const result = await callWebEnabledModel({
          env,
          messages: conversation,
          system: textSystemPrompt(project, context, toolNames),
          fetcher,
          signal,
          maxTokens: 1500,
          forceWebSearch: shouldSearchWeb(text),
          tools,
          toolChoice: forcedTool ? { type: 'tool', name: forcedTool } : null,
        });
        forcedTool = null;
        if (!result.toolCalls.length) {
          if (toolExecutions === 0 && toolNames.includes('project_http_request') && PROJECT_TOOL_DENIAL.test(result.content || '')) {
            conversation = [...conversation,
              { role: 'assistant', content: result.rawContent },
              { role: 'user', content: '运行时校验：project_http_request 已经挂载且可调用。上一答复关于工具不可用的说法错误。现在必须调用一次该工具，按 projectContext 从探测步骤开始，不要再解释能力。' },
            ];
            forcedTool = 'project_http_request';
            continue;
          }
          return { mode, reply: result.content, truncated: result.truncated, model: result.model, usage: result.usage };
        }
        if (!toolset) throw new AgentToolError('tool_call_required', 422);
        const toolResults = [];
        for (const call of result.toolCalls) {
          const toolResult = await toolset.execute(call);
          const toolContent = JSON.stringify(toolResult.data);
          if (toolContent.length > 1500000) throw new AgentToolError('timeline_result_too_large', 502);
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: toolContent });
          toolExecutions++;
        }
        conversation = [...conversation,
          { role: 'assistant', content: result.rawContent },
          { role: 'user', content: toolResults },
        ];
      }
      throw new AgentToolError('tool_round_limit', 422);
    } catch (error) {
      if (error instanceof ModelError || error instanceof AgentToolError) throw new AgentRunError(error.code, error.status);
      throw error;
    }
  }

  const createdAt = now().toISOString();
  const scope = { tenantId: actorId, projectId: projectKey };
  let source = null;
  let generationMessages = messages;
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
        toolChoice: 'auto',
      });
      if (selection.toolCalls.length > 1) throw new AgentToolError('tool_call_required', 422);
      if (selection.toolCalls.length === 1) {
        const toolResult = await toolset.execute(selection.toolCalls[0]);
        source = toolResult.source;
        const toolContent = JSON.stringify(toolResult.data);
        if (toolContent.length > 1500000) throw new AgentToolError('timeline_result_too_large', 502);
        generationMessages = [...messages,
          { role: 'assistant', content: selection.content, tool_calls: selection.toolCalls },
          { role: 'tool', tool_call_id: selection.toolCalls[0].id, content: toolContent },
        ];
      }
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
