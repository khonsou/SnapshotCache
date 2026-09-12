import { hash } from '../snapshot/json.mjs';
import { validateEnvelope } from '../snapshot/validate.mjs';

export class StoreError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const runFromRow = row => row && ({
  runId: row.run_id, actorId: row.actor_id, projectKey: row.project_key, idempotencyKey: row.idempotency_key,
  requestedMode: row.requested_mode, status: row.status, model: row.model, modelConfigVersion: row.model_config_version,
  contractVersion: row.contract_version, repairCount: row.repair_count, errorCode: row.error_code, reply: row.reply,
  snapshotId: row.snapshot_id, createdAt: row.created_at, finishedAt: row.finished_at,
});

const recordFromRow = row => row && ({
  snapshotId: row.snapshot_id, actorId: row.actor_id, projectKey: row.project_key, manifestHash: row.manifest_hash,
  objectPrefix: row.object_prefix, title: row.title, sourceKind: row.source_kind, model: row.model,
  contractVersion: row.contract_version, totalResourceBytes: row.total_resource_bytes, committedAt: row.committed_at,
  ...(row.message_id ? { messageId: row.message_id } : {}),
});

function requireBindings(env) {
  if (!env?.DB || !env?.BUCKET) throw new StoreError('storage_unavailable', 503);
  return { db: env.DB, bucket: env.BUCKET };
}

async function readR2Bytes(object) {
  if (!object) throw new StoreError('snapshot_not_found', 404);
  return new Uint8Array(await object.arrayBuffer());
}

async function verifyStored(bucket, key, expectedBytes, expectedHash) {
  const bytes = await readR2Bytes(await bucket.get(key));
  if (bytes.byteLength !== expectedBytes.byteLength || await hash(bytes) !== expectedHash) throw new StoreError('storage_verification_failed');
}

export function createSitesSnapshotStore(env) {
  const { db, bucket } = requireBindings(env);
  return {
    async startRun(run) {
      await db.prepare(`INSERT OR IGNORE INTO snapshot_runs
        (run_id, actor_id, project_key, idempotency_key, requested_mode, status, model_config_version, contract_version, created_at)
        VALUES (?, ?, ?, ?, ?, 'staging', ?, ?, ?)`)
        .bind(run.runId, run.actorId, run.projectKey, run.idempotencyKey, run.requestedMode, run.modelConfigVersion, run.contractVersion, run.createdAt).run();
      const row = await db.prepare(`SELECT * FROM snapshot_runs WHERE actor_id = ? AND project_key = ? AND idempotency_key = ?`)
        .bind(run.actorId, run.projectKey, run.idempotencyKey).first();
      if (!row) throw new StoreError('run_create_failed');
      return { created: row.run_id === run.runId, run: runFromRow(row) };
    },

    async failRun({ runId, actorId, projectKey, errorCode, model = null, repairCount = 0, finishedAt }) {
      await db.prepare(`UPDATE snapshot_runs SET status = 'failed', error_code = ?, model = ?, repair_count = ?, finished_at = ?
        WHERE run_id = ? AND actor_id = ? AND project_key = ? AND status = 'staging'`)
        .bind(errorCode, model, repairCount, finishedAt, runId, actorId, projectKey).run();
    },

    async getRun({ actorId, projectKey, idempotencyKey }) {
      return runFromRow(await db.prepare(`SELECT * FROM snapshot_runs WHERE actor_id = ? AND project_key = ? AND idempotency_key = ?`)
        .bind(actorId, projectKey, idempotencyKey).first());
    },

    async commitCandidate({ runId, messageId, actorId, projectKey, candidate, reply, model, repairCount, committedAt }) {
      const snapshotId = candidate.ref.snapshotId;
      const sourceKind = candidate.manifest.extensions?.['com.xuyan.generation']?.sourceKind || 'user-provided';
      const prefix = `snapshots/${snapshotId}/`;
      const run = await db.prepare(`SELECT status FROM snapshot_runs WHERE run_id = ? AND actor_id = ? AND project_key = ?`)
        .bind(runId, actorId, projectKey).first();
      if (!run || run.status !== 'staging') throw new StoreError('run_not_staging', 409);
      const existing = await db.prepare(`SELECT snapshot_id FROM snapshot_catalog WHERE snapshot_id = ? OR manifest_hash = ?`)
        .bind(snapshotId, candidate.ref.manifestHash).first();
      if (existing || await bucket.head(prefix + 'manifest.json')) throw new StoreError('snapshot_conflict', 409);
      for (const resource of candidate.manifest.resources) {
        const bytes = candidate.files.get(resource.path);
        const stored = await bucket.put(prefix + resource.path, bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: resource.mediaType },
          customMetadata: { snapshotId, resourceId: resource.id },
        });
        if (!stored) throw new StoreError('snapshot_conflict', 409);
        await verifyStored(bucket, prefix + resource.path, bytes, resource.sha256);
      }
      const manifestByteHash = await hash(candidate.bytes);
      const manifestStored = await bucket.put(prefix + 'manifest.json', candidate.bytes, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { snapshotId, manifestHash: candidate.ref.manifestHash, byteHash: manifestByteHash },
      });
      if (!manifestStored) throw new StoreError('snapshot_conflict', 409);
      await verifyStored(bucket, prefix + 'manifest.json', candidate.bytes, manifestByteHash);
      const statements = [
        db.prepare(`INSERT INTO snapshot_catalog
          (snapshot_id, actor_id, project_key, manifest_hash, object_prefix, title, source_kind, model, contract_version, total_resource_bytes, committed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'p2-1', ?, ?)`)
          .bind(snapshotId, actorId, projectKey, candidate.ref.manifestHash, prefix, candidate.title, sourceKind, model, candidate.manifest.totalResourceBytes, committedAt),
        db.prepare(`INSERT INTO message_snapshot_refs (message_id, actor_id, project_key, snapshot_id, manifest_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(messageId, actorId, projectKey, snapshotId, candidate.ref.manifestHash, committedAt),
        db.prepare(`UPDATE snapshot_runs SET status = 'committed', model = ?, repair_count = ?, reply = ?, snapshot_id = ?, finished_at = ?
          WHERE run_id = ? AND actor_id = ? AND project_key = ? AND status = 'staging'`)
          .bind(model, repairCount, reply, snapshotId, committedAt, runId, actorId, projectKey),
      ];
      await db.batch(statements);
      return { snapshotId, manifestHash: candidate.ref.manifestHash, title: candidate.title, sourceKind, messageId, committedAt };
    },

    async getRecord({ actorId, projectKey, snapshotId }) {
      return recordFromRow(await db.prepare(`SELECT c.*, m.message_id FROM snapshot_catalog c
        LEFT JOIN message_snapshot_refs m ON m.snapshot_id = c.snapshot_id
        WHERE c.actor_id = ? AND c.project_key = ? AND c.snapshot_id = ?`)
        .bind(actorId, projectKey, snapshotId).first());
    },

    async readManifest({ actorId, projectKey, snapshotId }) {
      const record = await this.getRecord({ actorId, projectKey, snapshotId });
      if (!record) throw new StoreError('snapshot_not_found', 404);
      const bytes = await readR2Bytes(await bucket.get(record.objectPrefix + 'manifest.json'));
      const manifest = await validateEnvelope(bytes, { snapshotId, manifestHash: record.manifestHash }, { tenantId: actorId, projectId: projectKey });
      return { record, manifest, bytes };
    },

    async readResource({ actorId, projectKey, snapshotId, resourceId }) {
      const loaded = await this.readManifest({ actorId, projectKey, snapshotId });
      const resource = loaded.manifest.resources.find(item => item.id === resourceId);
      if (!resource) throw new StoreError('resource_not_found', 404);
      const bytes = await readR2Bytes(await bucket.get(loaded.record.objectPrefix + resource.path));
      if (bytes.byteLength !== resource.byteLength || await hash(bytes) !== resource.sha256) throw new StoreError('resource_integrity_failed', 409);
      return { record: loaded.record, resource, bytes };
    },

    async listProjectSnapshots({ actorId, projectKey, limit = 50 }) {
      const result = await db.prepare(`SELECT c.*, m.message_id FROM snapshot_catalog c
        JOIN message_snapshot_refs m ON m.snapshot_id = c.snapshot_id
        WHERE c.actor_id = ? AND c.project_key = ? ORDER BY c.committed_at DESC LIMIT ?`)
        .bind(actorId, projectKey, Math.max(1, Math.min(50, limit))).all();
      return (result.results || []).map(recordFromRow);
    },
  };
}

export function createMemorySnapshotStore() {
  const runs = new Map();
  const catalog = new Map();
  const objects = new Map();
  const keyForRun = value => `${value.actorId}\0${value.projectKey}\0${value.idempotencyKey}`;
  const keyForSnapshot = value => `${value.actorId}\0${value.projectKey}\0${value.snapshotId}`;
  const store = {
    async startRun(run) {
      const key = keyForRun(run);
      if (runs.has(key)) return { created: false, run: structuredClone(runs.get(key)) };
      const saved = { ...run, status: 'staging', model: null, repairCount: 0, errorCode: null, reply: null, snapshotId: null, finishedAt: null };
      runs.set(key, saved);
      return { created: true, run: structuredClone(saved) };
    },
    async failRun(value) {
      const entry = [...runs.values()].find(run => run.runId === value.runId && run.actorId === value.actorId && run.projectKey === value.projectKey);
      if (entry?.status === 'staging') Object.assign(entry, { status: 'failed', errorCode: value.errorCode, model: value.model, repairCount: value.repairCount, finishedAt: value.finishedAt });
    },
    async getRun(value) { return structuredClone(runs.get(keyForRun(value)) || null); },
    async commitCandidate({ runId, messageId, actorId, projectKey, candidate, reply, model, repairCount, committedAt }) {
      const snapshotId = candidate.ref.snapshotId;
      const sourceKind = candidate.manifest.extensions?.['com.xuyan.generation']?.sourceKind || 'user-provided';
      const key = keyForSnapshot({ actorId, projectKey, snapshotId });
      const run = [...runs.values()].find(item => item.runId === runId && item.actorId === actorId && item.projectKey === projectKey);
      if (!run || run.status !== 'staging') throw new StoreError('run_not_staging', 409);
      if (catalog.has(key) || [...catalog.values()].some(item => item.manifestHash === candidate.ref.manifestHash)) throw new StoreError('snapshot_conflict', 409);
      const prefix = `snapshots/${snapshotId}/`;
      for (const resource of candidate.manifest.resources) {
        const objectKey = prefix + resource.path;
        if (objects.has(objectKey)) throw new StoreError('snapshot_conflict', 409);
        objects.set(objectKey, candidate.files.get(resource.path).slice());
      }
      objects.set(prefix + 'manifest.json', candidate.bytes.slice());
      const record = { snapshotId, actorId, projectKey, manifestHash: candidate.ref.manifestHash, objectPrefix: prefix, title: candidate.title, sourceKind, model, contractVersion: 'p2-1', totalResourceBytes: candidate.manifest.totalResourceBytes, committedAt, messageId };
      catalog.set(key, record);
      Object.assign(run, { status: 'committed', model, repairCount, reply, snapshotId, finishedAt: committedAt });
      return { snapshotId, manifestHash: candidate.ref.manifestHash, title: candidate.title, sourceKind, messageId, committedAt };
    },
    async getRecord(value) { return structuredClone(catalog.get(keyForSnapshot(value)) || null); },
    async readManifest(value) {
      const record = await this.getRecord(value);
      if (!record) throw new StoreError('snapshot_not_found', 404);
      const bytes = objects.get(record.objectPrefix + 'manifest.json')?.slice();
      if (!bytes) throw new StoreError('snapshot_not_found', 404);
      const manifest = await validateEnvelope(bytes, { snapshotId: value.snapshotId, manifestHash: record.manifestHash }, { tenantId: value.actorId, projectId: value.projectKey });
      return { record, manifest, bytes };
    },
    async readResource(value) {
      const loaded = await this.readManifest(value);
      const resource = loaded.manifest.resources.find(item => item.id === value.resourceId);
      if (!resource) throw new StoreError('resource_not_found', 404);
      const bytes = objects.get(loaded.record.objectPrefix + resource.path)?.slice();
      if (!bytes || bytes.byteLength !== resource.byteLength || await hash(bytes) !== resource.sha256) throw new StoreError('resource_integrity_failed', 409);
      return { record: loaded.record, resource, bytes };
    },
    async listProjectSnapshots({ actorId, projectKey, limit = 50 }) {
      return [...catalog.values()].filter(item => item.actorId === actorId && item.projectKey === projectKey).sort((a, b) => b.committedAt.localeCompare(a.committedAt)).slice(0, limit).map(item => structuredClone(item));
    },
    _objects: objects,
  };
  return store;
}
