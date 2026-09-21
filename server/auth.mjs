const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const TRANSACTION_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SESSIONS = 5000;
const MAX_TRANSACTIONS = 1000;

function base64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function randomOpaque(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function opaqueKey(value) {
  return base64Url(await sha256(value));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeReturnTo(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\r\n]/u.test(value)) return '/';
  try {
    const parsed = new URL(value, origin);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch { return '/'; }
}

function cookieNames(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return {
    secure,
    session: secure ? '__Host-xuyan-session' : 'xuyan_session',
    transaction: secure ? '__Host-xuyan-oauth' : 'xuyan_oauth',
  };
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

function cookie(name, value, { maxAge, secure }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}

function noStore(headers = {}) {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers };
}

function authJSON(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: noStore(headers) });
}

function redirect(location, cookies = []) {
  const headers = new Headers(noStore({ Location: location, 'Referrer-Policy': 'no-referrer' }));
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status: 302, headers });
}

function getPath(value, path) {
  return path.split('.').filter(Boolean).reduce((item, key) => item && typeof item === 'object' ? item[key] : undefined, value);
}

function profileIdentity(payload, configuredPath) {
  const candidates = [payload, payload?.data, payload?.user, payload?.data?.user].filter(item => item && typeof item === 'object');
  let id = configuredPath ? getPath(payload, configuredPath) : undefined;
  if (id === undefined) {
    for (const item of candidates) {
      id = item.id ?? item.user_id ?? item.userId ?? item.sub ?? item.uid;
      if (id !== undefined) break;
    }
  }
  if (!['string', 'number'].includes(typeof id) || !String(id).trim() || String(id).length > 160) throw new Error('profile_invalid');
  let name;
  for (const item of candidates) {
    name = item.name ?? item.user_name ?? item.display_name ?? item.displayName ?? item.nickname ?? item.username;
    if (typeof name === 'string' && name.trim()) break;
  }
  const normalizedName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : '公司用户';
  return { id: String(id).trim(), name: normalizedName };
}

function tokenIdentity(token) {
  if (typeof token !== 'string' || token.length > MAX_RESPONSE_BYTES) throw new Error('token_invalid');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('token_invalid');
  try {
    const normalized = parts[1].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
    return profileIdentity(JSON.parse(new TextDecoder().decode(bytes)), '');
  } catch { throw new Error('token_invalid'); }
}

async function limitedJSON(response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
  try { return JSON.parse(text); }
  catch { throw new Error('response_invalid'); }
}

function oauthConfig(env, request) {
  const origin = new URL(request.url).origin;
  const clientId = String(env.DAO_OAUTH_CLIENT_ID || '').trim();
  const authOrigin = String(env.VITE_AUTH_ORIGIN || 'https://auth.angrymiao.com').trim();
  const authorizationUrl = String(env.DAO_OAUTH_AUTHORIZATION_URL || new URL('/oauth/authorize', authOrigin)).trim();
  const tokenUrl = String(env.DAO_OAUTH_TOKEN_URL || new URL('/api/oauth/token', authOrigin)).trim();
  const profileUrl = String(env.DAO_OAUTH_PROFILE_URL || '').trim();
  const redirectUri = String(env.DAO_OAUTH_REDIRECT_URI || `${origin}/oauth/callback`).trim();
  const scopes = String(env.DAO_OAUTH_SCOPES || 'profile phone').trim();
  const urls = [authorizationUrl, tokenUrl, redirectUri, ...(profileUrl ? [profileUrl] : [])];
  let validUrls = true;
  try { validUrls = urls.every(value => value && ['https:', ...(env.NODE_ENV !== 'production' && env.XUYAN_AUTH_ALLOW_HTTP === 'true' ? ['http:'] : [])].includes(new URL(value).protocol)); }
  catch { validUrls = false; }
  return {
    configured: validUrls,
    clientId,
    clientSecret: String(env.DAO_OAUTH_CLIENT_SECRET || ''),
    authorizationUrl,
    tokenUrl,
    profileUrl,
    redirectUri,
    scopes,
    userIdPath: String(env.DAO_OAUTH_USER_ID_PATH || '').trim(),
    idleMs: positiveNumber(env.DAO_SESSION_IDLE_SECONDS, SESSION_IDLE_MS / 1000) * 1000,
    absoluteMs: positiveNumber(env.DAO_SESSION_ABSOLUTE_SECONDS, SESSION_ABSOLUTE_MS / 1000) * 1000,
  };
}

export function createMemoryAuthStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();
  const transactions = new Map();

  function cleanup(map, expired, maximum) {
    const current = now();
    for (const [key, value] of map) if (expired(value, current)) map.delete(key);
    while (map.size >= maximum) map.delete(map.keys().next().value);
  }

  return {
    async putTransaction(id, value) {
      cleanup(transactions, (item, current) => item.expiresAt <= current, MAX_TRANSACTIONS);
      transactions.set(await opaqueKey(id), value);
    },
    async takeTransaction(id) {
      if (!id) return null;
      const key = await opaqueKey(id);
      const value = transactions.get(key) || null;
      transactions.delete(key);
      return value && value.expiresAt > now() ? value : null;
    },
    async putSession(id, value) {
      cleanup(sessions, (item, current) => item.absoluteExpiresAt <= current || item.idleExpiresAt <= current || item.tokenExpiresAt <= current, MAX_SESSIONS);
      sessions.set(await opaqueKey(id), value);
    },
    async getSession(id, { touch = true } = {}) {
      if (!id) return null;
      const key = await opaqueKey(id);
      const value = sessions.get(key) || null;
      const current = now();
      if (!value || value.absoluteExpiresAt <= current || value.idleExpiresAt <= current || value.tokenExpiresAt <= current) {
        sessions.delete(key);
        return null;
      }
      if (touch) value.idleExpiresAt = Math.min(current + value.idleMs, value.absoluteExpiresAt, value.tokenExpiresAt);
      return value;
    },
    async deleteSession(id) {
      if (id) sessions.delete(await opaqueKey(id));
    },
    counts() { return { sessions: sessions.size, transactions: transactions.size }; },
  };
}

export function createDaoOAuthApp({ env = {}, fetcher = fetch, now = () => Date.now(), store = createMemoryAuthStore({ now }) } = {}) {
  const testBypass = env.NODE_ENV !== 'production' && env.XUYAN_AUTH_BYPASS === 'true';
  async function sessionFor(request, touch = true) {
    if (testBypass) {
      return { user: { id: 'local', name: '本地测试用户' }, absoluteExpiresAt: now() + SESSION_ABSOLUTE_MS, idleExpiresAt: now() + SESSION_IDLE_MS };
    }
    const names = cookieNames(request);
    return store.getSession(readCookie(request, names.session), { touch });
  }

  async function identity(request) {
    const session = await sessionFor(request);
    return session ? { ...session.user } : null;
  }

  async function login(request) {
    if (request.method !== 'GET') return authJSON({ error: 'method_not_allowed' }, 405);
    const config = oauthConfig(env, request);
    if (!config.configured) return authJSON({ error: 'oauth_not_configured' }, 503);
    if (testBypass) return redirect(safeReturnTo(new URL(request.url).searchParams.get('return_to'), new URL(request.url).origin));
    const names = cookieNames(request);
    const transactionId = randomOpaque();
    const state = randomOpaque();
    const verifier = randomOpaque(48);
    const challenge = base64Url(await sha256(verifier));
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('return_to'), new URL(request.url).origin);
    await store.putTransaction(transactionId, { state, verifier, returnTo, redirectUri: config.redirectUri, expiresAt: now() + TRANSACTION_MS });
    const target = new URL(config.authorizationUrl);
    const authorizeParams = new URLSearchParams({
      response_type: 'code', redirect_uri: config.redirectUri, scope: config.scopes,
      state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    if (config.clientId) authorizeParams.set('client_id', config.clientId);
    target.search = authorizeParams.toString();
    return redirect(target.toString(), [cookie(names.transaction, transactionId, { maxAge: TRANSACTION_MS / 1000, secure: names.secure })]);
  }

  function callbackFailure(request, code, names) {
    const target = new URL('/', new URL(request.url).origin);
    target.searchParams.set('auth_error', code);
    return redirect(target.toString(), [cookie(names.transaction, '', { maxAge: 0, secure: names.secure })]);
  }

  async function callback(request) {
    if (request.method !== 'GET') return authJSON({ error: 'method_not_allowed' }, 405);
    const config = oauthConfig(env, request);
    if (!config.configured) return authJSON({ error: 'oauth_not_configured' }, 503);
    const names = cookieNames(request);
    const url = new URL(request.url);
    const transaction = await store.takeTransaction(readCookie(request, names.transaction));
    if (url.searchParams.get('error')) return callbackFailure(request, 'oauth_denied', names);
    if (!transaction) return callbackFailure(request, 'oauth_transaction_missing', names);
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    if (!code || !state || state !== transaction.state || transaction.redirectUri !== config.redirectUri) return callbackFailure(request, 'oauth_state_invalid', names);
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: transaction.verifier,
      });
      if (config.clientId) form.set('client_id', config.clientId);
      if (config.clientSecret) form.set('client_secret', config.clientSecret);
      const tokenResponse = await fetcher(config.tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(10000),
      });
      const tokenPayload = await limitedJSON(tokenResponse);
      if (!tokenResponse.ok || typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token) throw new Error('token_exchange_failed');
      let user;
      if (config.profileUrl) {
        const profileResponse = await fetcher(config.profileUrl, {
          headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
        });
        const profilePayload = await limitedJSON(profileResponse);
        if (!profileResponse.ok) throw new Error('profile_failed');
        user = profileIdentity(profilePayload, config.userIdPath);
      } else {
        user = tokenIdentity(tokenPayload.access_token);
      }
      const current = now();
      const tokenLifetime = positiveNumber(tokenPayload.expires_in, config.absoluteMs / 1000) * 1000;
      const tokenExpiresAt = current + tokenLifetime;
      const absoluteExpiresAt = Math.min(current + config.absoluteMs, tokenExpiresAt);
      const sessionId = randomOpaque();
      await store.putSession(sessionId, {
        user, accessToken: tokenPayload.access_token, tokenExpiresAt, createdAt: current, absoluteExpiresAt,
        idleMs: config.idleMs, idleExpiresAt: Math.min(current + config.idleMs, absoluteExpiresAt),
      });
      const maxAge = Math.max(1, Math.floor((absoluteExpiresAt - current) / 1000));
      return redirect(new URL(transaction.returnTo, new URL(request.url).origin).toString(), [
        cookie(names.transaction, '', { maxAge: 0, secure: names.secure }),
        cookie(names.session, sessionId, { maxAge, secure: names.secure }),
      ]);
    } catch {
      return callbackFailure(request, 'oauth_exchange_failed', names);
    }
  }

  async function session(request) {
    if (request.method !== 'GET') return authJSON({ error: 'method_not_allowed' }, 405);
    const config = oauthConfig(env, request);
    if (!config.configured && !testBypass) return authJSON({ authenticated: false, configured: false, error: 'oauth_not_configured' }, 503);
    const active = await sessionFor(request);
    if (!active) return authJSON({ authenticated: false, configured: true }, 401);
    return authJSON({ authenticated: true, configured: true, user: active.user, expiresAt: new Date(active.absoluteExpiresAt).toISOString() });
  }

  async function logout(request) {
    if (request.method !== 'POST') return authJSON({ error: 'method_not_allowed' }, 405);
    const origin = request.headers.get('origin');
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return authJSON({ error: 'cross_site_forbidden' }, 403);
    const names = cookieNames(request);
    await store.deleteSession(readCookie(request, names.session));
    return authJSON({ ok: true }, 200, { 'Set-Cookie': cookie(names.session, '', { maxAge: 0, secure: names.secure }) });
  }

  async function handle(request) {
    const path = new URL(request.url).pathname;
    if (path === '/auth/login') return login(request);
    if (path === '/oauth/callback') return callback(request);
    if (path === '/api/session') return session(request);
    if (path === '/auth/logout') return logout(request);
    return authJSON({ error: 'not_found' }, 404);
  }

  return { handle, identity, store };
}
