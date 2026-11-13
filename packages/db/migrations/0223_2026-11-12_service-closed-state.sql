-- العمودان nullable عشان الخدمات الحالية تفضل مفتوحة من غير backfill أو قيمة مختلقة.
-- المهلة القصيرة للـ lock بتخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا الحركة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "closed_at" timestamptz;
--> statement-breakpoint
-- العلامة أثر للاسترجاع مش علاقة مستقلة، عشان كده مالهاش FK خاص بيها.
ALTER TABLE "services" ADD COLUMN "closed_by_category_id" uuid;
--> statement-breakpoint
-- القيدان NOT VALID عشان فحص الصفوف يتأجل لذيل 0224 بدل ما يحصل تحت قفل ADD COLUMN.
-- لازم العلامة تصف التصنيف الحالي وتكون مصحوبة بإغلاق فعلي، وإلا فتح التصنيف ممكن يرجّع خدمة غلط.
ALTER TABLE "services" ADD CONSTRAINT "services_closed_marker_requires_closed" CHECK ("closed_by_category_id" IS NULL OR "closed_at" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_closed_marker_is_category" CHECK ("closed_by_category_id" IS NULL OR ("category_id" IS NOT NULL AND "closed_by_category_id" = "category_id")) NOT VALID;
--> statement-breakpoint
-- التحديث عمود بعمود زي بقية أعمدة الخدمة؛ منح الجدول الكامل كان هيسمح بتغيير الهوية أو النشاط.
GRANT UPDATE (closed_at, closed_by_category_id) ON services TO pospay_app;
--> statement-breakpoint
-- الصلاحية مستقلة عن التعديل عشان قرار SI-Q17 يفضل مع المديرين الثلاثة من غير فتح باب التفويض.
INSERT INTO permissions(code) VALUES ('close:services:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager')
AND p.code = 'close:services:business'
ON CONFLICT DO NOTHING;
