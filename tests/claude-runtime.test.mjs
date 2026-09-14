import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { createClaudeCodeRuntime } from '../server/claude-runtime.mjs';

function fakeChild(run) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let prompt = '';
  child.stdin = new Writable({ write(chunk, _encoding, done) { prompt += chunk.toString(); done(); } });
  child.kill = () => child.emit('close', 143);
  queueMicrotask(() => run({ child, prompt: () => prompt }));
  return child;
}

const env = { DEEPSEEK_API_KEY: 'deepseek-secret', DEEPSEEK_MODEL: 'deepseek-flash' };
const http = {
  allowedPrefixes: [{ origin: 'https://timeline.example.test', pathname: '/board' }],
  secrets: [{ placeholder: '{{PROJECT_SECRET_1}}', value: 'board-secret' }],
  mode: 'read-auth-change-set',
};

test('Claude Code runtime is isolated, ephemeral and receives only allowlisted tools', async () => {
  let inspected = false;
  const runtime = createClaudeCodeRuntime({ spawnProcess: (binary, args, options) => fakeChild(({ child, prompt }) => {
    assert.match(binary, /node_modules\/@anthropic-ai\/claude-code\/bin\/claude\.exe$/);
    assert.equal(options.cwd.includes('xuyan-agent-'), true);
    assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
    assert.equal(options.env.ANTHROPIC_API_KEY, 'deepseek-secret');
    assert.equal(args.includes('--bare'), false);
    assert.equal(args.includes('--no-session-persistence'), true);
    assert.equal(args.includes('--strict-mcp-config'), true);
    assert.equal(args[args.indexOf('--setting-sources') + 1], 'project');
    assert.equal(args[args.indexOf('--tools') + 1], 'default');
    assert.equal(args.includes('--max-budget-usd'), false);
    assert.equal(args.join(' ').includes('WebSearch'), true);
    const denied = args[args.indexOf('--disallowedTools') + 1];
    assert.match(denied, /Bash/);
    assert.match(denied, /Read/);
    assert.match(denied, /WebFetch/);
    assert.equal(args.join(' ').includes('project_http_request'), true);
    assert.equal(args.join(' ').includes('board-secret'), false);
    assert.equal(prompt().includes('最后一条用户请求'), true);
    assert.equal(prompt().includes('board-secret'), false);
    const systemPath = args[args.indexOf('--system-prompt-file') + 1];
    assert.match(readFileSync(systemPath, 'utf8'), /PROJECT_SECRET_1/);
    assert.doesNotMatch(readFileSync(systemPath, 'utf8'), /board-secret/);
    inspected = true;
    child.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__project__project_http_request' }] } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '共有 1 张卡片。', session_id: 'runtime-session', num_turns: 2, usage: { input_tokens: 10 } })}\n`);
    child.stdout.end();
    child.emit('close', 0);
  }) });
  const result = await runtime.execute({
    env, project: '测试项目', context: '密码：{{PROJECT_SECRET_1}}', messages: [{ role: 'user', content: '统计卡片' }],
    requestedMode: 'auto', projectConfig: { http, source: { type: 'timeline', boardId: 'board' } },
  });
  assert.equal(inspected, true);
  assert.equal(result.reply, '共有 1 张卡片。');
  assert.equal(result.sessionId, 'runtime-session');
  assert.deepEqual(result.toolsUsed, ['project_http_request']);
  assert.equal(result.source.kind, 'timeline');
  assert.equal(result.model, 'deepseek-v4-flash');
});

test('submit_snapshot MCP output becomes the runtime snapshot result', async () => {
  const draft = {
    mode: 'snapshot', reply: '已生成。', title: '测试',
    datasets: [{ id: 'main', mediaType: 'application/json', content: { count: 1 } }],
    presentation: { html: '<!doctype html><html><head><title>x</title></head><body>ok</body></html>' },
  };
  const runtime = createClaudeCodeRuntime({ spawnProcess: (_binary, args) => fakeChild(({ child }) => {
    const mcpPath = args[args.indexOf('--mcp-config') + 1];
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    writeFileSync(mcp.mcpServers.project.args.at(-1), JSON.stringify(draft), { mode: 0o600 });
    child.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__project__submit_snapshot' }] } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '完成', session_id: 'snapshot-session', num_turns: 2 })}\n`);
    child.stdout.end();
    child.emit('close', 0);
  }) });
  const result = await runtime.execute({ env, project: '测试', context: '', messages: [{ role: 'user', content: '生成快照' }], requestedMode: 'snapshot', projectConfig: null });
  assert.equal(result.mode, 'snapshot');
  assert.deepEqual(result.snapshotDraft, draft);
  assert.deepEqual(result.toolsUsed, ['submit_snapshot']);
});
