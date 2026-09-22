CREATE TABLE `user_portfolios` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
