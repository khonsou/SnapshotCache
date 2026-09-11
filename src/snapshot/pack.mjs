import { utf8, hash, hashJSON } from './json.mjs';
import { contentHashes } from './validate.mjs';

export async function packSnapshot({ snapshotId, scope, createdAt, query, datasets, presentation, resources, parentSnapshotId, extensions, queryResourceId = 'query.context' }) {
  const descriptors = [];
  const files = new Map();
  for (const resource of resources) {
    const bytes = typeof resource.body === 'string' ? utf8(resource.body) : resource.body;
    if (files.has(resource.path)) throw new Error('Duplicate resource path');
    files.set(resource.path, bytes);
    descriptors.push({ id: resource.id, path: resource.path, mediaType: resource.mediaType, byteLength: bytes.length, sha256: await hash(bytes) });
  }
  descriptors.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const m = {
    schemaVersion: '1.0.0', snapshotId, scope, createdAt,
    ...(parentSnapshotId ? { parentSnapshotId } : {}),
    query: { resourceId: queryResourceId, fingerprint: '' },
    data: { datasets: datasets.map(d => ({ ...d, resourceIds: [...d.resourceIds].sort() })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), contentHash: '' },
    presentation: { ...presentation, resourceIds: [...presentation.resourceIds].sort(), contentHash: '' },
    resources: descriptors, totalResourceBytes: descriptors.reduce((sum, r) => sum + r.byteLength, 0),
    ...(extensions ? { extensions } : {}),
  };
  const hashes = await contentHashes(m, query);
  m.query.fingerprint = hashes.query; m.data.contentHash = hashes.data; m.presentation.contentHash = hashes.presentation;
  m.integrity = { manifestHash: await hashJSON(m) };
  return { manifest: m, bytes: utf8(JSON.stringify(m, null, 2) + '\n'), files };
}
