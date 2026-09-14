import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeSystemPrompt, runtimeUserPrompt } from '../src/agent/prompt.mjs';

const MCP_SERVER = fileURLToPath(new URL('./project-mcp.mjs', import.meta.url));
const PACKAGED_CLAUDE = fileURLToPath(new URL('../node_modules/@anthropic-ai/claude-code/bin/claude.exe', import.meta.url));
const MAX_RUNTIME_OUTPUT = 12_000_000;
const DISALLOWED_BUILTINS = [
  'Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch',
  'TodoWrite', 'TaskOutput', 'KillShell', 'AskUserQuestion', 'Skill', 'EnterPlanMode',
  'ExitPlanMode', 'LSP', 'ToolSearch',
];

function runtimeModel(env) {
  const configured = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  return configured === 'deepseek-flash' ? 'deepseek-v4-flash' : configured;
}

export class ClaudeRuntimeError extends Error {
  constructor(code, status = 502, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function publicToolName(name) {
  return typeof name === 'string' ? name.replace(/^mcp__project__/, '') : null;
}

function collectRecord(record, state) {
  if (record?.type === 'system' && record.subtype === 'init') {
    state.init = {
      tools: Array.isArray(record.tools) ? record.tools.filter(name => typeof name === 'string') : [],
      mcpServers: Array.isArray(record.mcp_servers)
        ? record.mcp_servers.map(server => ({ name: String(server?.name || ''), status: String(server?.status || '') }))
        : [],
    };
  }
  if (record?.type === 'assistant' && Array.isArray(record.message?.content)) {
    for (const part of record.message.content) {
      if (part?.type !== 'tool_use') continue;
      const name = publicToolName(part.name);
      if (name && !state.toolsUsed.includes(name)) state.toolsUsed.push(name);
    }
  }
  if (record?.type === 'result') state.result = record;
}

async function executeProcess({ binary, args, cwd, env, prompt, signal, spawnProcess }) {
  return await new Promise((resolve, reject) => {
    const child = spawnProcess(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { buffer: '', stderr: '', bytes: 0, toolsUsed: [], result: null, init: null };
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.stdout.on('data', chunk => {
      state.bytes += chunk.length;
      if (state.bytes > MAX_RUNTIME_OUTPUT) { child.kill('SIGTERM'); return; }
      state.buffer += chunk.toString('utf8');
      const lines = state.buffer.split('\n');
      state.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { collectRecord(JSON.parse(line), state); }
        catch { /* Claude Code may emit a non-event diagnostic line. */ }
      }
    });
    child.stderr.on('data', chunk => {
      if (state.stderr.length < 8000) state.stderr += chunk.toString('utf8');
    });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (state.buffer.trim()) {
        try { collectRecord(JSON.parse(state.buffer), state); }
        catch { /* handled as a missing result below */ }
      }
      if (signal?.aborted) { reject(new ClaudeRuntimeError('timeout', 504)); return; }
      if (state.bytes > MAX_RUNTIME_OUTPUT) { reject(new ClaudeRuntimeError('agent_runtime_output_too_large', 502)); return; }
      if (code !== 0 || !state.result || state.result.is_error) {
        reject(new ClaudeRuntimeError('agent_runtime_failed', 502, {
          exitCode: code,
          resultSubtype: typeof state.result?.subtype === 'string' ? state.result.subtype : null,
          toolsUsed: state.toolsUsed,
          availableTools: state.init?.tools || [],
          mcpServers: state.init?.mcpServers || [],
        }));
        return;
      }
      resolve(state);
    });
    child.stdin.end(prompt);
  });
}

export function createClaudeCodeRuntime({ spawnProcess = spawn } = {}) {
  return {
    async execute({ env, project, context, messages, requestedMode, projectConfig, signal }) {
      if (!env.DEEPSEEK_API_KEY) throw new ClaudeRuntimeError('not_configured', 503);
      const taskDir = await mkdtemp(join(tmpdir(), 'xuyan-agent-'));
      const configPath = join(taskDir, 'project-config.json');
      const mcpPath = join(taskDir, 'mcp.json');
      const systemPath = join(taskDir, 'system-prompt.txt');
      const snapshotPath = join(taskDir, 'snapshot.json');
      try {
        await writeFile(configPath, JSON.stringify({ http: projectConfig?.http || null, allowSnapshot: requestedMode !== 'text' }), { mode: 0o600 });
        await chmod(configPath, 0o600);
        await writeFile(mcpPath, JSON.stringify({
          mcpServers: {
            project: { type: 'stdio', command: process.execPath, args: [MCP_SERVER, configPath, snapshotPath] },
          },
        }), { mode: 0o600 });
        await chmod(mcpPath, 0o600);
        await writeFile(systemPath, runtimeSystemPrompt({ project, context, requestedMode, hasProjectHttp: Boolean(projectConfig?.http) }), { mode: 0o600 });
        await chmod(systemPath, 0o600);
        const model = runtimeModel(env);
        const tools = ['WebSearch'];
        if (requestedMode !== 'text') tools.push('mcp__project__submit_snapshot');
        if (projectConfig?.http) tools.push('mcp__project__project_http_request');
        const args = [
          '--print',
          '--disable-slash-commands',
          '--no-session-persistence',
          '--setting-sources', 'project',
          '--output-format', 'stream-json',
          '--verbose',
          '--permission-mode', 'dontAsk',
          '--strict-mcp-config',
          '--mcp-config', mcpPath,
          '--tools', 'default',
          '--allowedTools', tools.join(','),
          '--disallowedTools', DISALLOWED_BUILTINS.join(','),
          '--model', model,
          '--system-prompt-file', systemPath,
        ];
        const maxBudget = Number(env.AGENT_MAX_BUDGET_USD);
        if (Number.isFinite(maxBudget) && maxBudget > 0) args.push('--max-budget-usd', String(maxBudget));
        const childEnv = {
          ...process.env,
          ANTHROPIC_BASE_URL: env.DEEPSEEK_ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic',
          ANTHROPIC_API_KEY: env.DEEPSEEK_API_KEY,
          ANTHROPIC_AUTH_TOKEN: env.DEEPSEEK_API_KEY,
          ANTHROPIC_MODEL: model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
          CLAUDE_CODE_SUBAGENT_MODEL: model,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          CLAUDE_CODE_EFFORT_LEVEL: env.AGENT_EFFORT || 'medium',
        };
        const state = await executeProcess({
          binary: env.CLAUDE_CODE_BIN || PACKAGED_CLAUDE,
          args,
          cwd: taskDir,
          env: childEnv,
          prompt: runtimeUserPrompt(messages),
          signal,
          spawnProcess,
        });
        let snapshotDraft = null;
        try { snapshotDraft = JSON.parse(await readFile(snapshotPath, 'utf8')); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
        const finalText = typeof state.result.result === 'string' ? state.result.result.trim() : '';
        if (!finalText && !snapshotDraft) throw new ClaudeRuntimeError('agent_runtime_invalid_result', 502);
        if (requestedMode === 'snapshot' && !snapshotDraft) throw new ClaudeRuntimeError('snapshot_not_submitted', 422);
        const source = state.toolsUsed.includes('project_http_request') ? {
          sourceId: projectConfig?.source?.type === 'timeline' ? 'timeline' : 'project-http',
          revision: null,
          observedAt: new Date().toISOString(),
          kind: projectConfig?.source?.type || 'project-http',
          boardId: projectConfig?.source?.boardId,
        } : null;
        return {
          mode: snapshotDraft ? 'snapshot' : 'text',
          reply: snapshotDraft?.reply || finalText,
          snapshotDraft,
          source,
          runtime: 'claude-code',
          sessionId: typeof state.result.session_id === 'string' ? state.result.session_id : null,
          turns: Number.isInteger(state.result.num_turns) ? state.result.num_turns : null,
          toolsUsed: state.toolsUsed,
          model,
          usage: state.result.usage && typeof state.result.usage === 'object' ? state.result.usage : null,
          truncated: false,
        };
      } finally {
        await rm(taskDir, { recursive: true, force: true });
      }
    },
  };
}
