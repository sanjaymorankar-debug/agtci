CREATE TABLE `sso_sessions` (
	`id` varchar(64) NOT NULL,
	`sid` varchar(64) NOT NULL,
	`sub` varchar(64) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`entitled` boolean NOT NULL DEFAULT false,
	`permissions` json NOT NULL DEFAULT ('[]'),
	`access_token_enc` text NOT NULL,
	`id_token` text NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sso_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sso_sessions_sid_idx` ON `sso_sessions` (`sid`);--> statement-breakpoint
CREATE INDEX `sso_sessions_sub_idx` ON `sso_sessions` (`sub`);