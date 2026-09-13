const URL_PATTERN = /https?:\/\/[^\s<>"'`()\[\]{}\\，。；;]+/gim;
const SECRET_WITH_SEPARATOR = /((?:Timeline\s*)?(?:访问|看板)?密码|password|api[ _-]*key|token|secret|密钥)\s*[:：=]\s*([^\s，。；;]+)/gim;
const INLINE_PASSWORD = /(密码)\s*([A-Za-z0-9_.~!@#$%^&*+=-]{4,})(?=[\s，。；;]|$)/gim;

function normalizePrefix(value) {
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  return { origin: url.origin, pathname };
}

function uniquePrefixes(context) {
  const prefixes = [];
  for (const match of context.matchAll(URL_PATTERN)) {
    const normalized = normalizePrefix(match[0].replace(/[)\]}]+$/, ''));
    if (!normalized) continue;
    if (prefixes.some(item => item.origin === normalized.origin && item.pathname === normalized.pathname)) continue;
    prefixes.push(normalized);
    if (prefixes.length >= 12) break;
  }
  return prefixes.filter(candidate => !prefixes.some(other => other !== candidate && other.origin === candidate.origin
    && other.pathname !== candidate.pathname
    && (candidate.pathname === other.pathname || candidate.pathname.startsWith(`${other.pathname}/`))));
}

function redactSecrets(context) {
  const secrets = [];
  const values = new Map();
  const replace = (full, label, value) => {
    if (/^(?:换|错误|失效|缓存|锁|当配置管理)$/u.test(value)) return full;
    let placeholder = values.get(value);
    if (!placeholder) {
      placeholder = `{{PROJECT_SECRET_${secrets.length + 1}}}`;
      values.set(value, placeholder);
      secrets.push({ placeholder, value });
    }
    return full.replace(value, placeholder);
  };
  const separated = context.replace(SECRET_WITH_SEPARATOR, replace);
  return { safeContext: separated.replace(INLINE_PASSWORD, replace), secrets };
}

export function compileProjectContextRuntime(context) {
  const rawContext = typeof context === 'string' ? context : '';
  const { safeContext, secrets } = redactSecrets(rawContext);
  const allowedPrefixes = uniquePrefixes(rawContext);
  return {
    safeContext,
    http: allowedPrefixes.length ? { allowedPrefixes, secrets, mode: 'read-auth' } : null,
  };
}
