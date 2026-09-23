import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionOAuthConfig, createDaoOAuthApp, createMemoryAuthStore, validateProductionOAuthConfig } from '../server/auth.mjs';

const baseEnv = {
  DAO_OAUTH_CLIENT_ID: 'xuyan-test',
  DAO_OAUTH_CLIENT_SECRET: 'client-secret',
  DAO_OAUTH_AUTHORIZATION_URL: 'https://auth.example.test/oauth/authorize',
  DAO_OAUTH_TOKEN_URL: 'https://auth.example.test/api/oauth/token',
  DAO_OAUTH_PROFILE_URL: 'https://dao.example.test/api/current-user',
  DAO_OAUTH_REDIRECT_URI: 'http://app.example.test/oauth/callback',
  DAO_OAUTH_SCOPES: 'profile phone',
  XUYAN_AUTH_ALLOW_HTTP: 'true',
};

function firstCookie(response, prefix) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).find(value => value.startsWith(prefix));
}

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.test-signature`;
}

test('OAuth BFF completes PKCE login, exposes only safe session data and logs out', async () => {
  let current = Date.parse('2026-09-21T08:00:00Z');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === baseEnv.DAO_OAUTH_TOKEN_URL) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'valid-code');
      assert.equal(form.get('client_id'), 'xuyan-test');
      assert.equal(form.get('client_secret'), 'client-secret');
      assert.ok(form.get('code_verifier').length >= 43);
      return Response.json({ access_token: 'dao-access-secret', refresh_token: 'dao-refresh-secret', expires_in: 3600 });
    }
    assert.equal(url, baseEnv.DAO_OAUTH_PROFILE_URL);
    assert.equal(options.headers.Authorization, 'Bearer dao-access-secret');
    return Response.json({ data: { id: 'dao-user-42', name: '林安', phone: 'not-returned' } });
  };
  const app = createDaoOAuthApp({ env: baseEnv, fetcher, now: () => current, store: createMemoryAuthStore({ now: () => current }) });
  const login = await app.handle(new Request('http://app.example.test/auth/login?return_to=%2Fprojects%3Ftab%3Dactive'));
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, baseEnv.DAO_OAUTH_AUTHORIZATION_URL);
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('client_id'), 'xuyan-test');
  assert.equal(authorize.searchParams.get('redirect_uri'), baseEnv.DAO_OAUTH_REDIRECT_URI);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const transactionCookie = firstCookie(login, 'xuyan_oauth=');
  assert.ok(transactionCookie);

  const callback = await app.handle(new Request(`http://app.example.test/oauth/callback?code=valid-code&state=${encodeURIComponent(authorize.searchParams.get('state'))}`, { headers: { Cookie: transactionCookie } }));
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), 'http://app.example.test/projects?tab=active');
  const sessionCookie = firstCookie(callback, 'xuyan_session=');
  assert.ok(sessionCookie);
  assert.doesNotMatch(callback.headers.get('set-cookie'), /dao-access-secret|dao-refresh-secret/u);
  assert.equal(calls.length, 2);

  const session = await app.handle(new Request('http://app.example.test/api/session', { headers: { Cookie: sessionCookie } }));
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authenticated: true, configured: true, user: { id: 'dao-user-42', name: '林安' }, expiresAt: '2026-09-21T09:00:00.000Z',
  });
  assert.deepEqual(await app.identity(new Request('http://app.example.test/api/chat', { headers: { Cookie: sessionCookie } })), { id: 'dao-user-42', name: '林安' });

  const logout = await app.handle(new Request('http://app.example.test/auth/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: 'http://app.example.test' } }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/u);
  assert.equal((await app.handle(new Request('http://app.example.test/api/session', { headers: { Cookie: sessionCookie } }))).status, 401);
});

test('OAuth callback is one-time, rejects state mismatch and never calls the token endpoint', async () => {
  let calls = 0;
  const app = createDaoOAuthApp({ env: baseEnv, fetcher: async () => { calls++; return Response.json({}); } });
  const login = await app.handle(new Request('http://app.example.test/auth/login'));
  const transactionCookie = firstCookie(login, 'xuyan_oauth=');
  const callback = await app.handle(new Request('http://app.example.test/oauth/callback?code=stolen&state=wrong', { headers: { Cookie: transactionCookie } }));
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location'), /auth_error=oauth_state_invalid/u);
  assert.equal(calls, 0);
  const replay = await app.handle(new Request('http://app.example.test/oauth/callback?code=stolen&state=wrong', { headers: { Cookie: transactionCookie } }));
  assert.match(replay.headers.get('location'), /auth_error=oauth_transaction_missing/u);
});

test('sessions enforce server-side expiration and spoofed identity headers are ignored', async () => {
  let current = Date.parse('2026-09-21T08:00:00Z');
  const env = { ...baseEnv, DAO_SESSION_IDLE_SECONDS: '10', DAO_SESSION_ABSOLUTE_SECONDS: '60' };
  const app = createDaoOAuthApp({ env, now: () => current, store: createMemoryAuthStore({ now: () => current }), fetcher: async url => url === env.DAO_OAUTH_TOKEN_URL
    ? Response.json({ access_token: 'short-token', expires_in: 60 })
    : Response.json({ id: 'short-user', name: '短会话' }) });
  assert.equal(await app.identity(new Request('http://app.example.test/api/chat', { headers: { 'oai-authenticated-user-id': 'spoofed' } })), null);
  const login = await app.handle(new Request('http://app.example.test/auth/login'));
  const authorize = new URL(login.headers.get('location'));
  const callback = await app.handle(new Request(`http://app.example.test/oauth/callback?code=ok&state=${authorize.searchParams.get('state')}`, { headers: { Cookie: firstCookie(login, 'xuyan_oauth=') } }));
  const sessionCookie = firstCookie(callback, 'xuyan_session=');
  current += 10001;
  assert.equal((await app.handle(new Request('http://app.example.test/api/session', { headers: { Cookie: sessionCookie } }))).status, 401);
});

test('DAO defaults omit client_id and use JWT identity without a profile request', async () => {
  const env = {
    VITE_AUTH_ORIGIN: 'https://auth.example.test',
    DAO_OAUTH_REDIRECT_URI: 'http://app.example.test/oauth/callback',
    XUYAN_AUTH_ALLOW_HTTP: 'true',
  };
  let calls = 0;
  const app = createDaoOAuthApp({ env, fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://auth.example.test/api/oauth/token');
    assert.equal(new URLSearchParams(options.body).has('client_id'), false);
    return Response.json({ access_token: jwt({ user_id: 42, user_name: '林安' }), expires_in: 3600 });
  } });
  const login = await app.handle(new Request('http://app.example.test/auth/login'));
  const authorize = new URL(login.headers.get('location'));
  assert.equal(authorize.searchParams.has('client_id'), false);
  const callback = await app.handle(new Request(`http://app.example.test/oauth/callback?code=ok&state=${authorize.searchParams.get('state')}`, { headers: { Cookie: firstCookie(login, 'xuyan_oauth=') } }));
  assert.equal(callback.status, 302);
  assert.equal(calls, 1);
  const session = await app.handle(new Request('http://app.example.test/api/session', { headers: { Cookie: firstCookie(callback, 'xuyan_session=') } }));
  assert.deepEqual((await session.json()).user, { id: '42', name: '林安' });
});

test('invalid OAuth endpoints fail closed while explicit test bypass remains isolated', async () => {
  const unconfigured = createDaoOAuthApp({ env: { DAO_OAUTH_TOKEN_URL: 'javascript:invalid' } });
  assert.equal((await unconfigured.handle(new Request('https://app.example.test/auth/login'))).status, 503);
  assert.equal((await unconfigured.handle(new Request('https://app.example.test/api/session'))).status, 503);
  const bypass = createDaoOAuthApp({ env: { XUYAN_AUTH_BYPASS: 'true' } });
  const session = await bypass.handle(new Request('http://app.example.test/api/session'));
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.id, 'local');
});

test('production refuses HTTP OAuth and test bypass even when requested by environment', async () => {
  const app = createDaoOAuthApp({ env: {
    NODE_ENV: 'production', XUYAN_AUTH_BYPASS: 'true', XUYAN_AUTH_ALLOW_HTTP: 'true',
    DAO_OAUTH_REDIRECT_URI: 'http://app.example.test/oauth/callback',
  } });
  assert.equal((await app.handle(new Request('http://app.example.test/api/session'))).status, 503);
  assert.equal(await app.identity(new Request('http://app.example.test/api/chat')), null);
  assert.equal((await app.handle(new Request('http://app.example.test/auth/login'))).status, 503);
});

test('production startup requires pinned HTTPS endpoints and an exact callback on the public origin', () => {
  const valid = {
    NODE_ENV: 'production',
    APP_PUBLIC_ORIGIN: 'https://auth-test.example.com',
    DAO_OAUTH_REDIRECT_URI: 'https://auth-test.example.com/oauth/callback',
    DAO_OAUTH_AUTHORIZATION_URL: 'https://auth.example.com/oauth/authorize',
    DAO_OAUTH_TOKEN_URL: 'https://auth.example.com/api/oauth/token',
    DAO_OAUTH_SCOPES: 'profile phone',
  };
  assert.deepEqual(validateProductionOAuthConfig(valid), []);
  assert.doesNotThrow(() => assertProductionOAuthConfig(valid));

  const invalid = validateProductionOAuthConfig({
    ...valid,
    DAO_OAUTH_REDIRECT_URI: 'https://other.example.com/oauth/callback?next=/evil',
    DAO_OAUTH_TOKEN_URL: 'http://auth.example.com/token',
  });
  assert.deepEqual(invalid.sort(), ['DAO_OAUTH_REDIRECT_URI', 'DAO_OAUTH_TOKEN_URL']);
  assert.throws(() => assertProductionOAuthConfig({ ...valid, DAO_OAUTH_AUTHORIZATION_URL: '' }), /DAO_OAUTH_AUTHORIZATION_URL/u);
  assert.throws(() => assertProductionOAuthConfig({ ...valid, DAO_OAUTH_REDIRECT_URI: 'https://private-callback.example.com/oauth/callback?secret=hidden' }), error => {
    assert.match(error.message, /DAO_OAUTH_REDIRECT_URI/u);
    assert.doesNotMatch(error.message, /private-callback|hidden/u);
    return true;
  });
});

test('production cookies are host-only secure and external return targets are rejected', async () => {
  const env = { ...baseEnv, DAO_OAUTH_REDIRECT_URI: 'https://app.example.test/oauth/callback' };
  delete env.XUYAN_AUTH_ALLOW_HTTP;
  const app = createDaoOAuthApp({ env, fetcher: async url => url === env.DAO_OAUTH_TOKEN_URL
    ? Response.json({ access_token: 'production-token', expires_in: 3600 })
    : Response.json({ id: 'production-user', name: '生产用户' }) });
  const login = await app.handle(new Request('https://app.example.test/auth/login?return_to=https%3A%2F%2Fevil.example%2Fsteal'));
  assert.equal(login.status, 302);
  const transactionCookie = login.headers.getSetCookie().find(value => value.startsWith('__Host-xuyan-oauth='));
  assert.match(transactionCookie, /; Secure/u);
  assert.match(transactionCookie, /; HttpOnly/u);
  assert.match(transactionCookie, /; SameSite=Lax/u);
  assert.doesNotMatch(transactionCookie, /; Domain=/u);
  const authorize = new URL(login.headers.get('location'));
  const callback = await app.handle(new Request(`https://app.example.test/oauth/callback?code=ok&state=${authorize.searchParams.get('state')}`, { headers: { Cookie: transactionCookie.split(';')[0] } }));
  assert.equal(callback.headers.get('location'), 'https://app.example.test/');
  const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-xuyan-session='));
  assert.match(sessionCookie, /; Secure/u);
  assert.doesNotMatch(sessionCookie, /; Domain=/u);
});

test('logout rejects cross-site requests', async () => {
  const app = createDaoOAuthApp({ env: { XUYAN_AUTH_BYPASS: 'true' } });
  const response = await app.handle(new Request('https://app.example.test/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } }));
  assert.equal(response.status, 403);
});
