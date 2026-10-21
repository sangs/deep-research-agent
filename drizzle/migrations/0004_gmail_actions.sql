CREATE TABLE "gmail_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"message_ids" text[] NOT NULL,
	"added_label_ids" text[] NOT NULL,
	"removed_label_ids" text[] NOT NULL,
	"label_names" text[] NOT NULL,
	"before" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"undone_at" bigint,
	"undone_by" text
);
--> statement-breakpoint
CREATE INDEX "gmail_actions_created_idx" ON "gmail_actions" USING btree ("created_at");