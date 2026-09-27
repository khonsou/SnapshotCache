# Phase 0 DAO OAuth HTTPS acceptance

Status (2026-09-27): **user confirmed real-environment acceptance complete; itemized sanitized evidence has not been archived here**. The checklist below remains a record template; `NOT RECORDED` means the result was not supplied for this document, not that the test did not run. This runbook does not authorize further deployment or contact with DAO.

## Values to obtain before real acceptance

Record the non-secret values in the acceptance evidence. Put secrets only in the deployment secret manager; never paste them into this file, tickets, chat, screenshots, or logs.

| Obtain from | Exact value needed | Required use |
| --- | --- | --- |
| Deployment/domain owner | Final browser-facing HTTPS hostname (including whether a subdomain is used) | Set `APP_PUBLIC_ORIGIN` to `https://<hostname>` with no path or trailing route. Confirm TLS terminates for this host and the reverse proxy forwards the app correctly. |
| DAO operator | Exact registered HTTPS redirect URI | Set `DAO_OAUTH_REDIRECT_URI` exactly as registered. It must be `https://<same-hostname>/oauth/callback`; no query string, fragment, alternate port, or trailing slash. |
| DAO operator | Authorization endpoint URL | Set `DAO_OAUTH_AUTHORIZATION_URL` explicitly to the confirmed HTTPS endpoint. |
| DAO operator | Token endpoint URL | Set `DAO_OAUTH_TOKEN_URL` explicitly to the confirmed HTTPS endpoint. |
| DAO operator | Approved OAuth scopes and exact spelling | Set `DAO_OAUTH_SCOPES` explicitly (the current expected value is `profile phone`; confirm it rather than assuming). |
| DAO operator | Client registration requirement: whether this app has a client ID and whether it has a client secret | Current integration omits `client_id` when unset and sends it when configured; it sends a client secret only when configured. Obtain assigned values and the expected token request authentication method. Inject any secret only server-side. |
| DAO operator / API owner | Identity source and response contract: JWT format and stable user ID/name claim names, or profile endpoint URL and response shape | Current fallback reads `user_id`/`user_name` and common aliases from the access-token JWT without verifying a signature. If the real contract requires a profile endpoint or differs, record the sanitized shape and update the BFF before acceptance. Do not include real tokens. |
| DAO operator | Access-token expiry behavior and any required user-info/profile endpoint | Confirm `expires_in` behavior and whether the access token can be used to obtain the stable identity. Refresh-token handling is not currently implemented. |

The callback hostname and registered URI must be available before deployment. For a separate test environment, obtain a separately registered HTTPS callback for that hostname; do not substitute a local HTTP callback for real acceptance.

## Production configuration preflight

Set `NODE_ENV=production`, `APP_PUBLIC_ORIGIN`, `DAO_OAUTH_REDIRECT_URI`, `DAO_OAUTH_AUTHORIZATION_URL`, `DAO_OAUTH_TOKEN_URL`, and `DAO_OAUTH_SCOPES`. Inject `DAO_OAUTH_CLIENT_ID` and `DAO_OAUTH_CLIENT_SECRET` only if DAO assigned them. Set `DAO_OAUTH_PROFILE_URL` only when the confirmed identity contract requires it. Keep `XUYAN_AUTH_BYPASS` and `XUYAN_AUTH_ALLOW_HTTP` unset or `false`.

The Node BFF now refuses to start in production when the public origin or callback is not HTTPS, when the callback is not exactly `/oauth/callback` on the public origin, when the upstream endpoint values are absent or non-HTTPS, or when a development bypass is enabled. Error output lists configuration variable names only, never configured values. After setting values, restart the service and confirm it starts without printing environment contents. Do not put OAuth settings in `VITE_*` variables or client bundles.

Local preparation evidence (2026-09-23): `npm run check` passed (53 Node tests, build, 7 fixtures); `npm run test:e2e` passed (32 Chromium/WebKit tests) after allowing the local Playwright server to bind loopback. These are local code checks only and do not count as real DAO acceptance.

Local configuration update (2026-09-24): copied the deployment team's `.env` byte for byte into the Git-ignored local `.env` with mode `0600`. The three previous variables retained their values; the new file contains 18 assignments. With `NODE_ENV=production` supplied for the preflight, the application's production OAuth configuration validator passed; Node parsed the quoted scopes as `profile phone`. `npm run check` passed (53 Node tests, build, 7 fixtures), and `npm run test:e2e` passed (32 Chromium/WebKit tests) after the sandbox blocked its first loopback bind attempt. The file itself does not set `NODE_ENV`; the production runtime must set it. A nonempty client ID is now configured, so DAO must confirm the registration and token request contract. No live deployment, DAO callback, authorization, token exchange, or access control test was performed.

## Real acceptance procedure

Run only in the approved, DAO-registered HTTPS environment with an authorized test account.

1. Open the configured origin and start DAO login. Confirm the browser redirects to the confirmed authorization endpoint with the registered `redirect_uri`, approved scopes, `state`, and PKCE S256 challenge. Do not capture authorization codes in evidence.
2. Complete login. Confirm `/api/session` returns only the stable user ID/name and expiry, and page refresh preserves the session.
3. Confirm the session cookie is host-only, `Secure`, `HttpOnly`, `SameSite=Lax`, and named with the `__Host-` prefix. Confirm no OAuth token appears in browser storage, page responses, Agent input, snapshots, normal logs, or error responses.
4. Exercise one existing protected page/API and confirm it works while signed in. This phase does not establish DAO tag/project authorization.
5. Log out. Confirm the old cookie is rejected by `/api/session` and protected APIs return 401. Confirm cross-site logout is rejected.
6. Restart the single instance and log in again. The in-memory session is expected to require a new login after restart.
7. Review redacted service and browser evidence; do not store codes, cookies, access/refresh tokens, client secrets, or personal phone data.

## Evidence record

Fill this section with sanitized facts when available. Mark each result `PASS`, `FAIL`, or `NOT RECORDED`; attach evidence only in the approved private evidence store.

| Check | Result | Sanitized evidence / reference |
| --- | --- | --- |
| Public HTTPS origin and exact DAO-registered callback match | NOT RECORDED | |
| Authorization endpoint, token endpoint, and scopes confirmed with DAO | NOT RECORDED | |
| Client authentication and identity claim/profile contract confirmed | NOT RECORDED | |
| Production startup validation passed | NOT RECORDED | |
| PKCE S256 login and `/api/session` identity | NOT RECORDED | |
| Secure host-only cookie and refresh persistence | NOT RECORDED | |
| Protected API access while authenticated | NOT RECORDED | |
| Logout invalidates old session; cross-site logout rejected | NOT RECORDED | |
| Restart requires login and allows a new login | NOT RECORDED | |
| Token/secret absent from browser, Agent, snapshots, logs, and errors | NOT RECORDED | |

Environment hostname: `NOT PROVIDED`

Exact registered callback URI: `NOT PROVIDED`

Acceptance date/operator: `NOT RECORDED`
Overall Phase 0 result: **USER CONFIRMED ACCEPTED; ITEMIZED EVIDENCE NOT RECORDED**
