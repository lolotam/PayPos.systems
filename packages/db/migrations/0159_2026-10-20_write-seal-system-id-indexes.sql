-- الفهرس الفريد على الختم المزدوج بيتبني CONCURRENTLY في هجرة لوحده عشان ما يقفلش الكتابة (ADR-0033)؛
-- القيد نفسه بيتبدّل في 0160 في معاملة واحدة، فالجدول عمره ما يفضل من غير قيد (PP-9.1).
CREATE UNIQUE INDEX CONCURRENTLY "session_tip_revisions_session_seal_key" ON "session_tip_revisions" ("company_id","session_id","write_system_id","write_xid");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "slpc_line_seal_key" ON "service_line_performer_changes" ("company_id","line_id","write_system_id","write_xid");
