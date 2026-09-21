CREATE TABLE `team_source_ids` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	`team_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	CONSTRAINT `fk_team_source_ids_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_source_ids_source_external_id_unq` ON `team_source_ids` (`source`,`external_id`) WHERE ("team_source_ids"."deleted_at" is null);