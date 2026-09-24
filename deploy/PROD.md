# Production deployment

This deploys the current application unchanged to the `default` namespace. The app stores project edits, context, and chat history in browser memory; this configuration intentionally has no PVC because the server does not write those records to disk. Refreshing the page loses those edits. OAuth sessions remain in process memory, so the Deployment stays at one replica with `Recreate`.

The production host is supplied by `APP_HOST` in the local `.env`. The Node process listens on Pod port `4173` and serves the bundled UI, API, and SSE directly. The Service and Ingress route to that port; SSE buffering is disabled at the Ingress.

Before deployment:

1. Configure the OAuth callback and confirm the production authorization/token endpoints and scope with DAO. The deploy script does not validate these OAuth settings.
2. Add DNS for `APP_HOST` to the ingress LoadBalancer address. The Ingress uses `TLS_SECRET_NAME` in `K8S_NAMESPACE`.
3. `DEEPSEEK_API_KEY` is optional for a UI preview. Without it, the Agent API returns 503. Put it in the local `.env`; the script creates `APP_SECRET_NAME` when needed. Keep `DAO_OAUTH_CLIENT_SECRET` in the same local file if DAO assigns one.
4. Log in to the Aliyun registry, then run `bash deploy/deploy.sh`.

The script loads `.env` (or `ENV_FILE`), performs server-side dry-run validation, builds and pushes one tagged API image, then applies only this app's ConfigMap, Service, Deployment, and Ingress. It does not create a PVC or modify existing resources beyond the app resources.

Successful deployment does not verify that DAO OAuth callback registration or endpoint/scope settings are correct; validate login separately.

This is an infrastructure deployment of the current prototype, not a production data-persistence or project-authorization implementation. The repository's release plan still lists DAO project-tag access and Agent security findings as production gates.
