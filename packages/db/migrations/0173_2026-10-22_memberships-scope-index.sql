-- فهرس أذرع نوع النطاق في قارئ جرس العامل (057-3)؛ يُبنى CONCURRENTLY في هجرة لوحدها لأن جدول العضويات يتقبل الكتابة (ADR-0033).
CREATE INDEX CONCURRENTLY "memberships_scope_idx" ON "memberships" USING btree ("company_id","scope_type","scope_id");
