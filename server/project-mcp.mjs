import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { AgentToolError, createProjectHttpExecutor, projectHttpTool } from '../src/agent/tools.mjs';

const configPath = process.argv[2];
const snapshotPath = process.argv[3];
if (!configPath || !snapshotPath) process.exit(2);

const config = JSON.parse(await readFile(configPath, 'utf8'));
const executeHttp = config.http ? createProjectHttpExecutor({ config: config.http }) : null;
const allowSnapshot = config.allowSnapshot !== false;

const snapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'reply', 'title', 'datasets', 'presentation'],
  properties: {
    mode: { type: 'string', const: 'snapshot' },
    reply: { type: 'string', minLength: 1, maxLength: 6000 },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    datasets: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'mediaType', 'content'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' },
          mediaType: { type: 'string', enum: ['application/json', 'text/csv', 'text/markdown', 'text/plain'] },
          content: {},
        },
      },
    },
    presentation: {
      type: 'object', additionalProperties: false, required: ['html'],
      properties: { html: { type: 'string', minLength: 40, maxLength: 900000 }, initialState: { type: 'object' } },
    },
    notes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
  },
};

const submitSnapshotTool = {
  name: 'submit_snapshot',
  description: '提交本轮新生成的完整可视化快照候选。仅当用户明确要求创建或生成快照、可视化页面、图表或交互报告时使用。询问现有项目看板、卡片、数量、状态或数据分析时不得调用，应读取数据后直接文本回答。候选会由宿主执行协议、完整性和隔离安全校验。',
  inputSchema: snapshotSchema,
};

const httpMcpTool = {
  name: projectHttpTool.name,
  description: projectHttpTool.description,
  inputSchema: projectHttpTool.input_schema,
};

function send(id, result, error) {
  const message = error
    ? { jsonrpc: '2.0', id, error }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolError(error) {
  const code = error instanceof AgentToolError ? error.code : 'tool_failed';
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: code }) }], isError: true };
}

async function callTool(name, args) {
  if (name === 'project_http_request' && executeHttp) {
    try {
      const result = await executeHttp({ input: args });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) { return toolError(error); }
  }
  if (name === 'submit_snapshot' && allowSnapshot) {
    try {
      const value = JSON.stringify(args);
      if (value.length > 1500000) throw new AgentToolError('timeline_result_too_large', 422);
      await writeFile(snapshotPath, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, acceptedByHost: true }) }] };
    } catch (error) { return toolError(error); }
  }
  return toolError(new AgentToolError('tool_not_allowed', 422));
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); }
  catch { continue; }
  if (request.method === 'notifications/initialized') continue;
  if (request.id === undefined) continue;
  if (request.method === 'initialize') {
    send(request.id, {
      protocolVersion: request.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'xuyan-project-context', version: '1.0.0' },
    });
    continue;
  }
  if (request.method === 'ping') { send(request.id, {}); continue; }
  if (request.method === 'tools/list') {
    send(request.id, { tools: [...(executeHttp ? [httpMcpTool] : []), ...(allowSnapshot ? [submitSnapshotTool] : [])] });
    continue;
  }
  if (request.method === 'tools/call') {
    send(request.id, await callTool(request.params?.name, request.params?.arguments || {}));
    continue;
  }
  send(request.id, null, { code: -32601, message: 'Method not found' });
}
