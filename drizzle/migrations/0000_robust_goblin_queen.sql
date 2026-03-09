CREATE TABLE "curated_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"list_type" text NOT NULL,
	"added_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_digests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"digest" text NOT NULL,
	"generated_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "news_digests_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "research_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"messages" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
