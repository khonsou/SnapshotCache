export class ModelError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function callModel({ env, messages, system, fetcher = fetch, signal, maxTokens = 1500, tools, toolChoice }) {
  if (!env.DEEPSEEK_API_KEY) throw new ModelError('not_configured', 503);
  let response;
  try {
    response = await fetcher('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-flash',
        thinking: { type: 'disabled' },
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools?.length ? { tools, tool_choice: toolChoice || 'auto' } : {}),
      }),
    });
  } catch (error) {
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
  let result;
  try { result = await response.json(); }
  catch { throw new ModelError('invalid_reply'); }
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
    model: env.DEEPSEEK_MODEL || 'deepseek-flash',
    truncated: choice.finish_reason === 'length',
    usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
  };
}
