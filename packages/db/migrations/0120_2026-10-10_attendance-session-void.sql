ALTER TABLE "attendance_sessions" ADD COLUMN "voided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "voided_by" uuid;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "void_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_void_request_fk" FOREIGN KEY ("company_id","void_request_id") REFERENCES "public"."attendance_change_requests"("company_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_void_marks" CHECK (("attendance_sessions"."voided_at" IS NULL AND "attendance_sessions"."voided_by" IS NULL AND "attendance_sessions"."void_request_id" IS NULL) OR ("attendance_sessions"."voided_at" IS NOT NULL AND "attendance_sessions"."voided_by" IS NOT NULL AND "attendance_sessions"."void_request_id" IS NOT NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_void_closed" CHECK ("attendance_sessions"."voided_at" IS NULL OR "attendance_sessions"."status" <> 'OPEN') NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" DROP CONSTRAINT "attendance_change_requests_kind";
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_kind" CHECK ("attendance_change_requests"."kind" IN ('ADD_SESSION','VOID_SESSION','RESTORE_SESSION')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_session_kind" CHECK ("attendance_change_requests"."kind" NOT IN ('VOID_SESSION','RESTORE_SESSION') OR ("attendance_change_requests"."session_id" IS NOT NULL AND "attendance_change_requests"."session_revision" IS NOT NULL)) NOT VALID;
