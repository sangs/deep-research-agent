ALTER TABLE "news_digests" DROP CONSTRAINT "news_digests_cache_key_unique";--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "article_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "range_start" text;--> statement-breakpoint
ALTER TABLE "news_digests" ADD COLUMN "range_end" text;--> statement-breakpoint
CREATE UNIQUE INDEX "news_digests_user_cache_key_unique" ON "news_digests" USING btree ("user_id","cache_key");--> statement-breakpoint
CREATE INDEX "news_digests_user_mode_generated_idx" ON "news_digests" USING btree ("user_id","mode","generated_at");