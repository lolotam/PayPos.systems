ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_voided_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_void_request_fk";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_void_marks";
--> statement-breakpoint
ALTER TABLE "attendance_sessions" VALIDATE CONSTRAINT "attendance_sessions_void_closed";
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" VALIDATE CONSTRAINT "attendance_change_requests_kind";
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" VALIDATE CONSTRAINT "attendance_change_requests_session_kind";
