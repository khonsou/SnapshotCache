import { createClaudeCodeRuntime } from '../server/claude-runtime.mjs';
import { runAgent } from '../src/agent/run.mjs';

const env = { ...process.env };
if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured');
const runtime = createClaudeCodeRuntime();
const now = () => new Date();

const text = await runAgent({
  env,
  runtime,
  project: 'Agent Runtime 基线评测',
  projectKey: 'runtime-eval',
  context: '这是一次不含业务秘密的最小连通性评测。',
  messages: [{ role: 'user', content: '用一句话说明下一步应该先确认目标。' }],
  requestedMode: 'text',
  actorId: 'eval-user',
  now,
});
console.log(JSON.stringify({
  case: 'claude-runtime-text', model: text.model, runtime: text.runtime.name,
  session: Boolean(text.runtime.sessionId), turns: text.runtime.turns, toolsUsed: text.runtime.toolsUsed,
  replyChars: text.reply.length, truncated: text.truncated,
}));

let sequence = 0;
const snapshot = await runAgent({
  env,
  runtime,
  project: 'Agent Runtime 快照评测',
  projectKey: 'runtime-snapshot-eval',
  context: '用户提供的测试数据：已完成 3 项，未完成 2 项。',
  messages: [{ role: 'user', content: '生成一份简洁的项目进度快照。' }],
  requestedMode: 'snapshot',
  actorId: 'eval-user',
  now,
  idFactory: () => `eval-${++sequence}`,
});
console.log(JSON.stringify({
  case: 'claude-runtime-snapshot', model: snapshot.model, runtime: snapshot.runtime.name,
  session: Boolean(snapshot.runtime.sessionId), turns: snapshot.runtime.turns, toolsUsed: snapshot.runtime.toolsUsed,
  snapshotId: snapshot.candidate.ref.snapshotId,
  sourceKind: snapshot.candidate.manifest.extensions['com.xuyan.generation'].sourceKind,
  resources: snapshot.candidate.manifest.resources.length,
  totalResourceBytes: snapshot.candidate.manifest.totalResourceBytes,
}));
