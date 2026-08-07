CREATE TABLE `student_profiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `first_name` varchar(128),
  `last_name` varchar(128),
  `date_of_birth` varchar(10),
  `nationality` varchar(2),
  `country_of_origin` varchar(2),
  `preferred_locale` varchar(8),
  `university_id` int,
  `degree_program` varchar(256),
  `academic_year` varchar(32),
  `arrival_date` varchar(10),
  `expected_departure_date` varchar(10),
  `address_line` varchar(256),
  `postal_code` varchar(16),
  `city` varchar(128),
  `profile_completed` boolean NOT NULL DEFAULT false,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `student_profiles_id` PRIMARY KEY(`id`),
  CONSTRAINT `student_profiles_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `student_tags` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(64) NOT NULL,
  `color` varchar(16),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `student_tags_id` PRIMARY KEY(`id`),
  CONSTRAINT `student_tags_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `student_tag_assignments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `student_profile_id` int NOT NULL,
  `tag_id` int NOT NULL,
  `assigned_by_user_id` int,
  `assigned_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `student_tag_assignments_id` PRIMARY KEY(`id`),
  CONSTRAINT `student_tag_assignments_unique` UNIQUE(`student_profile_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `student_notes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `student_profile_id` int NOT NULL,
  `author_user_id` int,
  `note` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `student_notes_id` PRIMARY KEY(`id`)
);
