CREATE TABLE `admin_users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`password_hash` varchar(255) NOT NULL,
	`role` enum('ADMIN','STAFF') NOT NULL DEFAULT 'STAFF',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`actor_id` varchar(36),
	`action` varchar(255) NOT NULL,
	`entity_type` varchar(100) NOT NULL,
	`entity_id` varchar(255),
	`previous_value` json,
	`new_value` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`image_url` varchar(1000),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `certifications` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`is_enabled` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `certifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `certifications_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(36) NOT NULL,
	`source` enum('PRODUCT_QUOTE','GENERAL_QUOTE','CUSTOM_SOURCING','CONTACT_FORM') NOT NULL,
	`status` enum('NEW','CONTACTED','REQUIREMENT_CONFIRMED','QUOTATION_SENT','NEGOTIATION','ORDER_RECEIVED','COMPLETED','LOST') NOT NULL DEFAULT 'NEW',
	`full_name` varchar(255) NOT NULL,
	`company_name` varchar(255),
	`country` varchar(100),
	`email` varchar(255) NOT NULL,
	`phone` varchar(50),
	`product_id` varchar(36),
	`product_name_snapshot` varchar(255),
	`quantity` varchar(255),
	`specification` text,
	`quality_requirement` text,
	`packaging` varchar(255),
	`destination_country` varchar(100),
	`target_price` varchar(255),
	`delivery_timeline` varchar(255),
	`additional_info` text,
	`attachments` json NOT NULL DEFAULT ('[]'),
	`assigned_to` varchar(36),
	`notes` text,
	`follow_up_date` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(36) NOT NULL,
	`category_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`short_description` text,
	`description` text,
	`images` json NOT NULL DEFAULT ('[]'),
	`origin` varchar(255),
	`grades` json NOT NULL DEFAULT ('[]'),
	`packaging_options` json NOT NULL DEFAULT ('[]'),
	`moq` varchar(255),
	`supply_capability` text,
	`export_available` boolean NOT NULL DEFAULT true,
	`specifications` json NOT NULL DEFAULT ('[]'),
	`certifications` json NOT NULL DEFAULT ('[]'),
	`is_featured` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`seo_title` varchar(255),
	`seo_description` varchar(500),
	`seo_keywords` varchar(500),
	`og_image_url` varchar(1000),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` varchar(36) NOT NULL,
	`title` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`icon` varchar(100),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `services_id` PRIMARY KEY(`id`),
	CONSTRAINT `services_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `site_content` (
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_content_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_admin_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_assigned_to_admin_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_source_idx` ON `leads` (`source`);--> statement-breakpoint
CREATE INDEX `leads_created_idx` ON `leads` (`created_at`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_featured_idx` ON `products` (`is_featured`);--> statement-breakpoint
CREATE INDEX `products_active_idx` ON `products` (`is_active`);