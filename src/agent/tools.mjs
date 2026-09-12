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

function parseArguments(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new AgentToolError('tool_arguments_invalid', 422);
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new AgentToolError('tool_arguments_invalid', 422); }
}

export function createProjectToolset({ env, projectConfig, fetcher = fetch, signal, now }) {
  if (projectConfig?.source?.type !== 'timeline') return null;
  const password = env[projectConfig.source.credentialEnv];
  let client;
  try { client = createTimelineClient({ ...projectConfig.source, password, fetcher, signal, now }); }
  catch (error) {
    if (error instanceof TimelineError) throw new AgentToolError(error.code, error.status);
    throw error;
  }
  return {
    definitions: [timelineTool],
    async execute(call) {
      if (!call || call.type !== 'function' || call.function?.name !== 'timeline_read_board') throw new AgentToolError('tool_not_allowed', 422);
      try {
        const data = await client.readBoard(parseArguments(call.function.arguments));
        return { name: 'timeline_read_board', data, source: data.source };
      } catch (error) {
        if (error instanceof AgentToolError) throw error;
        if (error instanceof TimelineError) throw new AgentToolError(error.code, error.status);
        throw new AgentToolError('timeline_unavailable');
      }
    },
  };
}
