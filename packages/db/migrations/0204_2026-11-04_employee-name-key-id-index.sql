-- الفهرس مبني CONCURRENTLY في هجرة لوحدها عشان ما يمسكش الكتابة على جدول الموظفين أثناء بنائه (ADR-0033).
-- الجملة دي أول ما في الملف، فلازم تفضل قبل أي جملة تانية: الـ runner بينفّذ البادئة دي بره معاملة.
CREATE INDEX CONCURRENTLY "employees_company_business_name_en_key_id_active_idx" ON "employees" USING btree ("company_id","business_id","name_en_key","id") WHERE "deleted_at" IS NULL;
