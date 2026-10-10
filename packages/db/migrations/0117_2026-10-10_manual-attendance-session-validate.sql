-- الفهرس خارج المعاملة ثم التحقق بعد تحرير أقفال إضافة الأعمدة.
CREATE INDEX CONCURRENTLY "attendance_sessions_change_request_idx" ON "attendance_sessions" USING btree ("company_id","change_request_id");
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_source";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_close_pair";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_manual_link";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_manual_shape";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_change_request_fk";
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" VALIDATE CONSTRAINT "attendance_change_requests_add_values";
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" VALIDATE CONSTRAINT "attendance_change_requests_add_only";
