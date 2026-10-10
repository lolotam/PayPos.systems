-- إضافة اليوم اليدوي وربطه بالطلب؛ تأجيل القيد يسمح بموافقة المالك المباشرة.
CREATE INDEX CONCURRENTLY "attendance_change_requests_pending_add_idx" ON "attendance_change_requests" USING btree ("company_id","employee_id") WHERE "attendance_change_requests"."kind" = 'ADD_SESSION' AND "attendance_change_requests"."status" = 'PENDING';
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "change_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_source";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_source" CHECK ("attendance_sessions"."source" IN ('QR','BARCODE','MANUAL')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_close_pair";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_close_pair" CHECK (("attendance_sessions"."status" = 'OPEN' AND "attendance_sessions"."clock_out" IS NULL AND "attendance_sessions"."closed_by" IS NULL) OR ("attendance_sessions"."status" <> 'OPEN' AND "attendance_sessions"."clock_out" >= "attendance_sessions"."clock_in" AND "attendance_sessions"."closed_by" IN ('EMPLOYEE','MISSED_OUT','MANUAL'))) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_manual_link" CHECK (("attendance_sessions"."source" = 'MANUAL') = ("attendance_sessions"."change_request_id" IS NOT NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_manual_shape" CHECK (("attendance_sessions"."closed_by" <> 'MANUAL' OR "attendance_sessions"."source" = 'MANUAL') AND ("attendance_sessions"."source" <> 'MANUAL' OR ("attendance_sessions"."status" = 'CLOSED' AND "attendance_sessions"."closed_by" IS NOT NULL AND "attendance_sessions"."closed_by" = 'MANUAL' AND "attendance_sessions"."clock_out" IS NOT NULL AND "attendance_sessions"."binding_id" IS NULL AND "attendance_sessions"."out_binding_id" IS NULL AND "attendance_sessions"."device_id" IS NULL AND "attendance_sessions"."out_device_id" IS NULL AND "attendance_sessions"."operator_id" IS NULL AND "attendance_sessions"."out_operator_id" IS NULL AND "attendance_sessions"."qr_window" IS NULL AND "attendance_sessions"."out_qr_window" IS NULL AND "attendance_sessions"."latitude" IS NULL AND "attendance_sessions"."longitude" IS NULL AND "attendance_sessions"."accuracy" IS NULL AND "attendance_sessions"."out_latitude" IS NULL AND "attendance_sessions"."out_longitude" IS NULL AND "attendance_sessions"."out_accuracy" IS NULL AND "attendance_sessions"."geo" = 'NONE' AND ("attendance_sessions"."out_geo" IS NULL OR "attendance_sessions"."out_geo" = 'NONE')))) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD COLUMN "clock_in" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD COLUMN "clock_out" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD COLUMN "working_date" date;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD COLUMN "timezone" text;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_add_values" CHECK ("attendance_change_requests"."kind" <> 'ADD_SESSION' OR ("attendance_change_requests"."clock_in" IS NOT NULL AND "attendance_change_requests"."clock_out" IS NOT NULL AND "attendance_change_requests"."working_date" IS NOT NULL AND "attendance_change_requests"."timezone" IS NOT NULL AND "attendance_change_requests"."clock_out" > "attendance_change_requests"."clock_in" AND "attendance_change_requests"."session_revision" IS NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_add_only" CHECK ("attendance_change_requests"."kind" = 'ADD_SESSION' OR ("attendance_change_requests"."clock_in" IS NULL AND "attendance_change_requests"."clock_out" IS NULL AND "attendance_change_requests"."working_date" IS NULL AND "attendance_change_requests"."timezone" IS NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_change_request_fk" FOREIGN KEY ("company_id","change_request_id") REFERENCES "public"."attendance_change_requests"("company_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED NOT VALID;
