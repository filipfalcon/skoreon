CREATE TABLE `team_aliases` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	`team_id` text NOT NULL,
	`source` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_team_aliases_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_aliases_source_name_unq` ON `team_aliases` (`source`,`name`) WHERE ("team_aliases"."deleted_at" is null);