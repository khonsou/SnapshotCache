CREATE TABLE `message_snapshot_refs` (
	`message_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`project_key` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshot_catalog`(`snapshot_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_message_snapshot_refs_snapshot` ON `message_snapshot_refs` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_message_snapshot_refs_actor_project_created` ON `message_snapshot_refs` (`actor_id`,`project_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `snapshot_catalog` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`project_key` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`object_prefix` text NOT NULL,
	`title` text NOT NULL,
	`source_kind` text NOT NULL,
	`model` text NOT NULL,
	`contract_version` text NOT NULL,
	`total_resource_bytes` integer NOT NULL,
	`committed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_snapshot_catalog_manifest_hash` ON `snapshot_catalog` (`manifest_hash`);--> statement-breakpoint
CREATE INDEX `idx_snapshot_catalog_actor_project_committed` ON `snapshot_catalog` (`actor_id`,`project_key`,`committed_at`);--> statement-breakpoint
CREATE TABLE `snapshot_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`project_key` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_mode` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`model_config_version` text NOT NULL,
	`contract_version` text NOT NULL,
	`repair_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`snapshot_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_snapshot_runs_actor_project_idempotency` ON `snapshot_runs` (`actor_id`,`project_key`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_snapshot_runs_actor_project_created` ON `snapshot_runs` (`actor_id`,`project_key`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
