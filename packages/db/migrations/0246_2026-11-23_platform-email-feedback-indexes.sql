-- The indexes of the email feedback tables, built concurrently (CLAUDE.md §10). They live in their own
-- migration because a concurrent build cannot run inside the transaction that creates the table.
CREATE INDEX CONCURRENTLY "platform_email_feedback_inbox_enqueue_idx" ON "platform_email_feedback_inbox" USING btree ("received_at","id") WHERE "enqueue_confirmed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "platform_email_feedback_inbox_pending_idx" ON "platform_email_feedback_inbox" USING btree ("next_attempt_at","id") WHERE "resolved_at" IS NULL AND "quarantined_at" IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "platform_email_feedback_inbox_retention_idx" ON "platform_email_feedback_inbox" USING btree ("received_at","id") WHERE "raw_event" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "platform_email_audit_inbox_idx" ON "platform_email_audit" USING btree ("inbox_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "notification_attempt_feedback_attempt_idx" ON "notification_attempt_feedback" USING btree ("company_id","attempt_id","provider_timestamp" DESC);
