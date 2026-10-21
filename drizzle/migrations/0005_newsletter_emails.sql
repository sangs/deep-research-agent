CREATE TABLE "newsletter_emails" (
	"message_id" text PRIMARY KEY NOT NULL,
	"sender" text NOT NULL,
	"subject" text NOT NULL,
	"date_header" text NOT NULL,
	"snippet" text NOT NULL,
	"links" text[] NOT NULL,
	"summary" text NOT NULL,
	"summary_version" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "newsletter_emails_created_idx" ON "newsletter_emails" USING btree ("created_at");