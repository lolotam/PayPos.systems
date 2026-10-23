-- مفاتيح ربط الاستهلاك (D-21) على جداول فيها حركة بتُبنى CONCURRENTLY في هجرة لوحدها عشان ما تقفلش الكتابة (ADR-0033)؛ الربط نفسه في 0179 والتحقق في 0180.
CREATE UNIQUE INDEX CONCURRENTLY "service_lines_id_session_key" ON "service_lines" ("company_id","id","session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "service_sessions_branch_id_key" ON "service_sessions" ("company_id","branch_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "dp_consumed_line_binding_key" ON "discount_proposals" ("company_id","id","consumed_line_id","business_id","service_id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY "dp_session_branch_fk_idx" ON "discount_proposals" ("company_id","branch_id","session_id") WHERE "session_id" IS NOT NULL;
