-- الفهرس مبني CONCURRENTLY في هجرة لوحدها عشان ما يمسكش الكتابة على جدول الخدمات أثناء بنائه (ADR-0033).
-- الجملة دي أول ما في الملف، فلازم تفضل قبل أي جملة تانية: الـ runner بينفّذ البادئة دي بره معاملة.
CREATE INDEX CONCURRENTLY "services_business_category_idx" ON "services" USING btree ("company_id","business_id","category_id");
--> statement-breakpoint
-- التحقق بيحصل في ذيل معاملته، بعد ما 0194 خلص: قفل SHARE UPDATE EXCLUSIVE بس، من غير مسح للجدول تحت قفل ADD COLUMN.
ALTER TABLE "services" VALIDATE CONSTRAINT "services_duration_bounds";
--> statement-breakpoint
ALTER TABLE "services" VALIDATE CONSTRAINT "services_category_fk";
