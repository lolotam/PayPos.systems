CREATE TABLE "consumed_events" (
	"company_id" uuid NOT NULL,
	"consumer_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumed_events_pkey" PRIMARY KEY("company_id","consumer_id","event_id"),
	CONSTRAINT "consumed_events_consumer_id_format" CHECK ("consumed_events"."consumer_id" ~ '^[a-z][a-z0-9.-]{1,99}$')
);
--> statement-breakpoint
DROP INDEX "outbox_unpublished_idx";--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "outbox_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "parked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consumed_events" ADD CONSTRAINT "consumed_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_aggregate_idx" ON "outbox" USING btree ("company_id","aggregate_type","aggregate_id","seq") WHERE "outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("seq") WHERE "outbox"."published_at" IS NULL;