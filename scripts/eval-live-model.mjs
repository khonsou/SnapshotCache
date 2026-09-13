import { runAgent } from '../src/agent/run.mjs';
import { compileProjectContextRuntime } from '../src/platform/context-runtime.mjs';

const env = { ...process.env, DEEPSEEK_SNAPSHOT_MAX_TOKENS: process.env.DEEPSEEK_SNAPSHOT_MAX_TOKENS || '7000', TIMELINE_EVAL_PASSWORD: 'evaluation-only' };
if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured');

const now = () => new Date('2026-09-12T12:00:00Z');
const text = await runAgent({
  env,
  project: '模型基线评测',
  projectKey: 'model-eval',
  context: '这是一次不含业务秘密的最小连通性评测。',
  messages: [{ role: 'user', content: '用一句话说明下一步应该先确认目标。' }],
  requestedMode: 'text',
  actorId: 'eval-user',
  now,
});
console.log(JSON.stringify({ case: 'text', model: text.model, replyChars: text.reply.length, truncated: text.truncated }));

let sequence = 0;
const agentContext = `链接：https://timeline-eval.invalid/prefix/
看板id：eval-board
密码evaluation-only。
访问说明：先 GET {API}/api/meta 和 GET {API}/api/agent-doc；POST {API}/api/boards/{board_id}/auth，以 {"password":"看板密码引用"} 换取 token；之后使用 Authorization: Bearer token 调用 GET /api/boards/{board_id}/items。`;
const runtime = compileProjectContextRuntime(agentContext);
const projectConfig = {
  key: 'timeline-eval', title: 'Timeline 工具评测', context: runtime.safeContext, http: runtime.http,
  source: { type: 'timeline', baseUrl: 'https://timeline-eval.invalid/prefix', boardId: 'eval-board', credentialEnv: 'TIMELINE_EVAL_PASSWORD' },
};
const httpCalls = [];
const fetcher = async (url, options) => {
  if (url.startsWith('https://api.deepseek.com/')) {
    if (options.body.includes('evaluation-only') || options.body.includes('evaluation-token')) throw new Error('Evaluation secret leaked to model');
    return fetch(url, options);
  }
  const path = new URL(url).pathname;
  httpCalls.push(`${options.method || 'GET'} ${path}`);
  const headers = { 'X-Protocol-Version': '19.2' };
  if (path.endsWith('/api/meta')) return Response.json({ protocol_version: '19.2', capabilities: ['items.read'], features: { groups: true, relations: true }, enums: { status: ['待执行', '待发布', '已发布'] } }, { headers });
  if (path.endsWith('/api/agent-doc')) return new Response('POST /api/boards/:id/auth; GET /api/boards/:id/items', { headers: { ...headers, 'Content-Type': 'text/markdown' } });
  if (path.endsWith('/auth')) return Response.json({ token: 'evaluation-token' }, { headers });
  if (path.endsWith('/items')) return Response.json({ items: [{ id: 'eval-1', title: '核对真实数据源', date: '2026-09-12', status: '待执行', member_id: 'member-1' }], board_version: 1 }, { headers });
  if (path.endsWith('/products')) return Response.json({ products: [] }, { headers });
  if (path.endsWith('/members')) return Response.json({ members: [{ id: 'member-1', name: '评测成员' }] }, { headers });
  throw new Error(`Unexpected evaluation URL: ${url}`);
};
const timelineText = await runAgent({
  env,
  project: projectConfig.title,
  projectKey: projectConfig.key,
  context: runtime.safeContext,
  projectConfig,
  messages: [{ role: 'user', content: '这个看板一共有多少张卡片？只回答数量和数据来源。' }],
  requestedMode: 'text',
  actorId: 'eval-user',
  fetcher,
  now,
});
console.log(JSON.stringify({ case: 'project-http-text', model: timelineText.model, httpCalls, reply: timelineText.reply, truncated: timelineText.truncated }));
const snapshotProjectConfig = { ...projectConfig, context: '只读评测', http: null };
const snapshot = await runAgent({
  env,
  project: snapshotProjectConfig.title,
  projectKey: snapshotProjectConfig.key,
  context: snapshotProjectConfig.context,
  projectConfig: snapshotProjectConfig,
  messages: [{ role: 'user', content: '读取 Timeline，生成一份包含事项、状态和负责人的项目概览快照。' }],
  requestedMode: 'snapshot',
  actorId: 'eval-user',
  fetcher,
  now,
  idFactory: () => `eval-${++sequence}`,
});
console.log(JSON.stringify({
  case: 'timeline-tool-snapshot',
  model: snapshot.model,
  repairCount: snapshot.attempt,
  snapshotId: snapshot.candidate.ref.snapshotId,
  sourceKind: snapshot.candidate.manifest.extensions['com.xuyan.generation'].sourceKind,
  resources: snapshot.candidate.manifest.resources.length,
  totalResourceBytes: snapshot.candidate.manifest.totalResourceBytes,
  truncated: snapshot.truncated,
}));
