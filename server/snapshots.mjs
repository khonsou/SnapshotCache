import { validProjectKey } from '../src/agent/intent.mjs';
import { createSitesSnapshotStore, StoreError } from '../src/platform/store.mjs';
import { assetHeaders } from './headers.mjs';
import { json } from './api.mjs';

const idPattern = '[A-Za-z0-9][A-Za-z0-9_.-]{0,127}';

function actorFor(request, env) {
  return env.SNAPSHOT_LOCAL ? 'local' : request.headers.get('oai-authenticated-user-id');
}

function snapshotResponse(bytes, method) {
  return new Response(method === 'HEAD' ? null : bytes, { headers: assetHeaders({ type: 'application/octet-stream', snapshot: true }) });
}

export async function handleSnapshotRequest(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  const actorId = actorFor(request, env);
  if (!actorId) return json({ error: '请先登录后访问快照。' }, 401);
  const path = new URL(request.url).pathname;
  const listMatch = path.match(new RegExp(`^/api/projects/(${idPattern})/snapshots$`));
  const manifestMatch = path.match(new RegExp(`^/api/projects/(${idPattern})/snapshots/(${idPattern})/manifest$`));
  const resourceMatch = path.match(new RegExp(`^/api/projects/(${idPattern})/snapshots/(${idPattern})/resources/(${idPattern})$`));
  if (!listMatch && !manifestMatch && !resourceMatch) return json({ error: 'Not found' }, 404);
  const projectKey = (listMatch || manifestMatch || resourceMatch)[1];
  if (!validProjectKey(projectKey)) return json({ error: 'Not found' }, 404);
  let store;
  try { store = env.SNAPSHOT_STORE || createSitesSnapshotStore(env); }
  catch (error) { return json({ error: '快照存储暂不可用。', errorCode: error.code || 'storage_unavailable' }, error.status || 503); }
  try {
    if (listMatch) {
      const entries = await store.listProjectSnapshots({ actorId, projectKey });
      return json({ entries: entries.map(item => ({
        title: item.title,
        committedAt: item.committedAt,
        messageId: item.messageId,
        ref: { snapshotId: item.snapshotId, manifestHash: item.manifestHash },
        scope: { tenantId: actorId, projectId: projectKey },
        sourceKind: item.sourceKind,
      })) });
    }
    if (manifestMatch) {
      const loaded = await store.readManifest({ actorId, projectKey, snapshotId: manifestMatch[2] });
      return snapshotResponse(loaded.bytes, request.method);
    }
    const loaded = await store.readResource({ actorId, projectKey, snapshotId: resourceMatch[2], resourceId: resourceMatch[3] });
    return snapshotResponse(loaded.bytes, request.method);
  } catch (error) {
    if (error instanceof StoreError) return json({ error: error.status === 404 ? 'Not found' : '快照资源不可用。', errorCode: error.code }, error.status);
    return json({ error: '快照资源不可用。' }, 500);
  }
}
