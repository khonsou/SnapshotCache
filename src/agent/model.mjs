export class ModelError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function modelName(env) { return env.DEEPSEEK_MODEL || 'deepseek-flash'; }

async function providerResponse(fetcher, url, options, signal) {
  let response;
  try { response = await fetcher(url, options); }
  catch {
    if (signal?.aborted) throw new ModelError('timeout', 504);
    throw new ModelError('network_error');
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    if (status === 429) throw new ModelError('provider_busy', 429);
    if (status === 401 || status === 403) throw new ModelError('provider_auth');
    if (status === 402) throw new ModelError('provider_balance');
    throw new ModelError('provider_unavailable');
  }
  try { return await response.json(); }
  catch { throw new ModelError('invalid_reply'); }
}

export async function callModel({ env, messages, system, fetcher = fetch, signal, maxTokens = 1500, tools, toolChoice }) {
  if (!env.DEEPSEEK_API_KEY) throw new ModelError('not_configured', 503);
  const result = await providerResponse(fetcher, 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName(env),
        thinking: { type: 'disabled' },
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools?.length ? { tools, tool_choice: toolChoice || 'auto' } : {}),
      }),
    }, signal);
  const choice = result.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const toolCalls = message?.tool_calls;
  const validContent = typeof content === 'string' && content.trim() && content.length <= 100000;
  const validToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls.length <= 4 && toolCalls.every(call =>
    call && typeof call.id === 'string' && call.id.length <= 128 && call.type === 'function'
    && call.function && typeof call.function.name === 'string' && typeof call.function.arguments === 'string');
  if (!validContent && !validToolCalls) throw new ModelError('invalid_reply');
  return {
    content: validContent ? content : null,
    toolCalls: validToolCalls ? toolCalls : [],
    finishReason: choice.finish_reason,
    model: modelName(env),
    truncated: choice.finish_reason === 'length',
    usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
  };
}

export async function callWebEnabledModel({ env, messages, system, fetcher = fetch, signal, maxTokens = 1500, forceWebSearch = false, tools = [], toolChoice = null }) {
  if (!env.DEEPSEEK_API_KEY) throw new ModelError('not_configured', 503);
  const searchInstruction = forceWebSearch ? '本轮涉及实时公开信息，必须先调用 web_search，再根据搜索结果回答并附可核验的来源 URL。' : '';
  const result = await providerResponse(fetcher, 'https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'x-api-key': env.DEEPSEEK_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName(env),
      system: searchInstruction ? `${system}\n${searchInstruction}` : system,
      messages,
      thinking: { type: 'disabled' },
      max_tokens: maxTokens,
      stream: false,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, ...tools],
      tool_choice: toolChoice || { type: 'auto' },
    }),
  }, signal);
  const toolCalls = Array.isArray(result.content) ? result.content.filter(part =>
    part?.type === 'tool_use' && typeof part.id === 'string' && part.id.length <= 128
    && typeof part.name === 'string' && part.input && typeof part.input === 'object' && !Array.isArray(part.input)) : [];
  if (toolCalls.length > 4) throw new ModelError('invalid_reply');
  const content = Array.isArray(result.content) ? result.content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n') : '';
  if ((!content.trim() && !toolCalls.length) || content.length > 100000) throw new ModelError('invalid_reply');
  return {
    content: content.trim() ? content : null,
    toolCalls,
    rawContent: result.content,
    finishReason: result.stop_reason,
    model: modelName(env),
    truncated: result.stop_reason === 'max_tokens',
    usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
  };
}
