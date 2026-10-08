CREATE TABLE "budget_raises" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"limit_usd" double precision NOT NULL,
	"previous_limit_usd" double precision NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"user_id" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_counters_user_id_bucket_window_start_pk" PRIMARY KEY("user_id","bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"cost_usd" double precision NOT NULL,
	"run_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "budget_raises_user_day_idx" ON "budget_raises" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "usage_events_user_day_idx" ON "usage_events" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "usage_events_user_feature_created_idx" ON "usage_events" USING btree ("user_id","feature","created_at");