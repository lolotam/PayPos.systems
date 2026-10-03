ALTER TABLE "file_objects" DROP CONSTRAINT "file_objects_size";--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "purge_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "file_objects_retention_pending_idx" ON "file_objects" USING btree ("company_id","created_at") WHERE "file_objects"."status" = 'PENDING' AND "file_objects"."confirmed_at" IS NULL AND "file_objects"."purged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "file_objects_retention_rejected_idx" ON "file_objects" USING btree ("company_id","rejected_at") WHERE "file_objects"."status" = 'REJECTED' AND "file_objects"."purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_type" CHECK ("file_objects"."content_type" IN ('application/pdf','image/jpeg','image/png'));--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_size" CHECK ("file_objects"."size_bytes" BETWEEN 1 AND 10485760);