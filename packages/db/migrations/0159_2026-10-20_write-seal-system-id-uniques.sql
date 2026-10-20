-- المفاتيح الجديدة بتتغيّر لتضمّ معرّف الـ cluster، وبتتبني CONCURRENTLY عشان ما تقفلش الكتابة (ADR-0033).
CREATE UNIQUE INDEX CONCURRENTLY "session_tip_revisions_session_seal_key" ON "session_tip_revisions" ("company_id","session_id","write_system_id","write_xid");
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY "slpc_line_seal_key" ON "service_line_performer_changes" ("company_id","line_id","write_system_id","write_xid");
--> statement-breakpoint
-- تبديل القيد بنفس الاسم: الاختبارات وخطط المشروع بيسمّوا القيد، وUSING INDEX بيعيد تسمية الـ index نفسه.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE session_tip_revisions DROP CONSTRAINT session_tip_revisions_session_xid_uq;
--> statement-breakpoint
ALTER TABLE session_tip_revisions ADD CONSTRAINT session_tip_revisions_session_xid_uq UNIQUE USING INDEX session_tip_revisions_session_seal_key;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes DROP CONSTRAINT slpc_line_xid_uq;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes ADD CONSTRAINT slpc_line_xid_uq UNIQUE USING INDEX slpc_line_seal_key;
