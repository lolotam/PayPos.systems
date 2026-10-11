CREATE INDEX CONCURRENTLY "attendance_sessions_voided_by_idx" ON "attendance_sessions" USING btree ("company_id","voided_by");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "attendance_sessions_void_request_idx" ON "attendance_sessions" USING btree ("company_id","void_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "attendance_change_requests_one_pending_session" ON "attendance_change_requests" USING btree ("company_id","session_id") WHERE "attendance_change_requests"."status" = 'PENDING' AND "attendance_change_requests"."kind" IN ('VOID_SESSION','RESTORE_SESSION');
