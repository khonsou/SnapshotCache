import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const snapshotRuns = sqliteTable('snapshot_runs', {
  runId: text('run_id').primaryKey(),
  actorId: text('actor_id').notNull(),
  projectKey: text('project_key').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestedMode: text('requested_mode').notNull(),
  status: text('status').notNull(),
  model: text('model'),
  modelConfigVersion: text('model_config_version').notNull(),
  contractVersion: text('contract_version').notNull(),
  repairCount: integer('repair_count').notNull().default(0),
  errorCode: text('error_code'),
  reply: text('reply'),
  snapshotId: text('snapshot_id'),
  createdAt: text('created_at').notNull(),
  finishedAt: text('finished_at'),
}, table => [
  uniqueIndex('uq_snapshot_runs_actor_project_idempotency').on(table.actorId, table.projectKey, table.idempotencyKey),
  index('idx_snapshot_runs_actor_project_created').on(table.actorId, table.projectKey, table.createdAt),
]);

export const snapshotCatalog = sqliteTable('snapshot_catalog', {
  snapshotId: text('snapshot_id').primaryKey(),
  actorId: text('actor_id').notNull(),
  projectKey: text('project_key').notNull(),
  manifestHash: text('manifest_hash').notNull(),
  objectPrefix: text('object_prefix').notNull(),
  title: text('title').notNull(),
  sourceKind: text('source_kind').notNull(),
  model: text('model').notNull(),
  contractVersion: text('contract_version').notNull(),
  totalResourceBytes: integer('total_resource_bytes').notNull(),
  committedAt: text('committed_at').notNull(),
}, table => [
  uniqueIndex('uq_snapshot_catalog_manifest_hash').on(table.manifestHash),
  index('idx_snapshot_catalog_actor_project_committed').on(table.actorId, table.projectKey, table.committedAt),
]);

export const messageSnapshotRefs = sqliteTable('message_snapshot_refs', {
  messageId: text('message_id').primaryKey(),
  actorId: text('actor_id').notNull(),
  projectKey: text('project_key').notNull(),
  snapshotId: text('snapshot_id').notNull().references(() => snapshotCatalog.snapshotId),
  manifestHash: text('manifest_hash').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('uq_message_snapshot_refs_snapshot').on(table.snapshotId),
  index('idx_message_snapshot_refs_actor_project_created').on(table.actorId, table.projectKey, table.createdAt),
]);
