export class ContextConfigError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function valueFromLine(context, label) {
  return context.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：=]\\s*([^\\n]+?)\\s*(?:$|\\n)`, 'im'))?.[1]?.trim() || null;
}

function normalizeUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new ContextConfigError('timeline_context_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ContextConfigError('timeline_context_invalid');
  return url.href.replace(/\/$/, '');
}

function redactPassword(context) {
  return context.replace(/(^|\n)(\s*Timeline\s*(?:访问)?密码\s*[:：=]\s*)[^\n]*/gim, '$1$2[已配置，仅服务端使用]');
}

export function hasTimelineContextDeclaration(context) {
  return typeof context === 'string' && /(?:^|\n)\s*(?:Timeline\s*(?:(?:API\s*)?(?:地址|基地址|base(?:\s*URL)?)|(?:访问)?密码)|(?:Timeline\s*)?(?:看板\s*ID|board\s*ID))\s*[:：=]/im.test(context);
}

export function inspectTimelineProjectContext(context) {
  if (typeof context !== 'string') return { declared: false, safeContext: '', source: null };
  const safeContext = redactPassword(context);
  const baseUrl = valueFromLine(context, 'Timeline\\s*(?:API\\s*)?(?:地址|基地址|base(?:\\s*URL)?)');
  const boardId = valueFromLine(context, '(?:Timeline\\s*)?(?:看板\\s*ID|board\\s*ID)');
  const password = valueFromLine(context, 'Timeline\\s*(?:访问)?密码');
  if (!baseUrl && !boardId && !password) return { declared: false, safeContext, source: null };
  if (!baseUrl || !boardId || !password || boardId.length > 128 || password.length > 4096) return { declared: true, safeContext, source: null };
  return {
    declared: true,
    safeContext,
    source: { type: 'timeline', baseUrl: normalizeUrl(baseUrl), boardId, password },
  };
}

export function resolveContextTimelineSource(context) {
  const inspected = inspectTimelineProjectContext(context);
  if (!inspected.declared) return null;
  if (!inspected.source) throw new ContextConfigError('timeline_context_invalid');
  return inspected.source;
}
