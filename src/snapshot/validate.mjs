import validators from './generated/schema.cjs';
import { parseJSON, hash, hashJSON, decode } from './json.mjs';
import { inspectHTML } from './html.mjs';
const { validateManifest, validateQuery } = validators;

export const LIMITS = Object.freeze({ manifestBytes: 128 * 1024, fileBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, files: 64 });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => a.tenantId === b.tenantId && a.projectId === b.projectId;
const unique = (items, what) => assert(new Set(items).size === items.length, 'Duplicate ' + what);
function sorted(items, what) {
  unique(items, what);
  assert(items.every((item, i) => !i || items[i - 1] < item), 'Unsorted ' + what);
}
export function safePath(path) {
  return typeof path === 'string' && path.length <= 256 && path.split('/').every(p => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && p !== '.' && p !== '..');
}
const selected = (manifest, ids) => manifest.resources.filter(r => ids.has(r.id));
export async function contentHashes(manifest, query) {
  const { contentHash: _ignored, ...definition } = manifest.presentation;
  const dataIds = new Set(manifest.data.datasets.flatMap(d => d.resourceIds));
  return {
    query: await hashJSON({ identityVersion: '1', scope: manifest.scope, identity: query.identity }),
    data: await hashJSON({ datasets: manifest.data.datasets, resources: selected(manifest, dataIds) }),
    presentation: await hashJSON({ definition, resources: selected(manifest, new Set(definition.resourceIds)) }),
  };
}

export async function validateEnvelope(bytes, expected, scope) {
  assert(bytes.byteLength <= LIMITS.manifestBytes, 'Manifest too large');
  const m = parseJSON(bytes);
  assert(validateManifest(m), 'Manifest schema invalid: ' + JSON.stringify(validateManifest.errors));
  assert(expected && m.snapshotId === expected.snapshotId, 'Snapshot identity mismatch');
  assert(scope && same(m.scope, scope), 'Project scope mismatch');
  const { integrity, ...definition } = m;
  const actual = await hashJSON(definition);
  assert(actual === expected.manifestHash && actual === integrity.manifestHash, 'Trusted manifest hash mismatch');
  assert(m.resources.length <= LIMITS.files && m.totalResourceBytes <= LIMITS.totalBytes, 'Package limit exceeded');
  sorted(m.resources.map(r => r.id), 'resource IDs');
  sorted(m.data.datasets.map(d => d.id), 'dataset IDs');
  unique(m.resources.map(r => r.path.toLowerCase()), 'resource path');
  for (const r of m.resources) {
    assert(safePath(r.path) && r.path.toLowerCase() !== 'manifest.json', 'Unsafe resource path');
    assert(r.byteLength <= LIMITS.fileBytes, 'Resource limit exceeded');
  }
  return m;
}

export async function validatePackage(manifestBytes, files, expected, scope, parents = new Map()) {
  const m = await validateEnvelope(manifestBytes, expected, scope);
  assert(files instanceof Map && files.size === m.resources.length, 'Unlisted or missing files');
  const byId = new Map(m.resources.map(r => [r.id, r]));
  const get = id => { const r = byId.get(id); assert(r, 'Missing resource reference: ' + id); return r; };
  let size = 0;
  for (const r of m.resources) {
    const bytes = files.get(r.path);
    assert(bytes instanceof Uint8Array && bytes.byteLength === r.byteLength, 'Resource byte length mismatch: ' + r.path);
    assert(await hash(bytes) === r.sha256, 'Resource hash mismatch: ' + r.path);
    size += bytes.byteLength;
  }
  assert(size === m.totalResourceBytes, 'Total size mismatch');
  assert(get(m.query.resourceId).mediaType === 'application/json', 'Invalid query MIME');
  const query = parseJSON(files.get(get(m.query.resourceId).path));
  assert(validateQuery(query), 'Query schema invalid: ' + JSON.stringify(validateQuery.errors));
  sorted(query.identity.sourceSelections.map(s => s.sourceId), 'source selections');
  sorted(query.observations.map(s => s.sourceId), 'source observations');
  for (const source of query.identity.sourceSelections) {
    const observed = query.observations.find(o => o.sourceId === source.sourceId);
    assert(observed && (source.revision === null || observed.revision === source.revision), 'Source revision mismatch');
  }
  assert(query.observations.every(o => query.identity.sourceSelections.some(s => s.sourceId === o.sourceId)), 'Unselected observation');
  const used = new Set([m.query.resourceId]);
  const dataIds = new Set();
  for (const d of m.data.datasets) {
    sorted(d.resourceIds, 'dataset resources');
    assert(d.resourceIds.includes(d.entryResourceId), 'Dataset entry not included');
    if (d.schemaResourceId) assert(d.resourceIds.includes(d.schemaResourceId), 'Dataset schema not included');
    for (const id of d.resourceIds) { get(id); used.add(id); dataIds.add(id); }
  }
  const p = m.presentation;
  sorted(p.resourceIds, 'presentation resources');
  assert(p.resourceIds.includes(p.entryResourceId) && get(p.entryResourceId).mediaType === 'text/html', 'Invalid HTML entry');
  if (p.initialStateResourceId) {
    assert(p.resourceIds.includes(p.initialStateResourceId) && get(p.initialStateResourceId).mediaType === 'application/json', 'Invalid initial state');
    parseJSON(files.get(get(p.initialStateResourceId).path));
  }
  for (const id of p.resourceIds) { get(id); used.add(id); assert(!dataIds.has(id) && id !== m.query.resourceId, 'Resource roles overlap'); }
  assert(!dataIds.has(m.query.resourceId), 'Query must be separate from data');
  for (const datasetId of Object.values(p.bindings)) assert(m.data.datasets.some(d => d.id === datasetId), 'Unknown binding');
  assert(used.size === m.resources.length, 'Orphan resource');
  // This runtime supports self-contained HTML plus an optional initial state. Other web packages fail closed.
  assert(p.resourceIds.every(id => id === p.entryResourceId || id === p.initialStateResourceId), 'Unsupported runtime dependency');
  const html = decode(files.get(get(p.entryResourceId).path));
  inspectHTML(html);
  const hashes = await contentHashes(m, query);
  assert(hashes.query === m.query.fingerprint, 'Query fingerprint mismatch');
  assert(hashes.data === m.data.contentHash, 'Data content hash mismatch');
  assert(hashes.presentation === p.contentHash, 'Presentation content hash mismatch');
  if (m.parentSnapshotId) {
    const parent = parents.get(m.parentSnapshotId);
    assert(m.parentSnapshotId !== m.snapshotId && parent && same(parent.scope, m.scope), 'Parent scope or existence invalid');
  }
  return { manifest: m, query, files, html };
}
