-- عمودان إضافيان على الخدمات: المدة بالدقائق الكاملة والتصنيف اللي تحته؛ الاتنين nullable فالقواعد القديمة ما بتتأثرش.
-- المهلة القصيرة للـ lock بتخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا الحركة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "duration_minutes" smallint;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "category_id" uuid;
--> statement-breakpoint
-- القيد بيتضاف NOT VALID عشان ما يفحصش جدول الخدمات تحت قفل تقيل؛ التحقق في ذيل 0195 (نمط 0169/0170).
ALTER TABLE "services" ADD CONSTRAINT "services_duration_bounds" CHECK ("services"."duration_minutes" IS NULL OR "services"."duration_minutes" BETWEEN 1 AND 600) NOT VALID;
--> statement-breakpoint
-- المفتاح المركّب يحمل النشاط كمان، فتصنيف نشاط تاني في نفس الشركة مستحيل في قاعدة البيانات مش في النطاق بس.
ALTER TABLE "services" ADD CONSTRAINT "services_category_fk" FOREIGN KEY ("company_id","business_id","category_id") REFERENCES "public"."service_categories"("company_id","business_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
-- منح التحديث عمود بعمود زي بقية أعمدة الخدمة (migration 0084)؛ الهوية والنشاط غير قابلين للتحديث.
GRANT UPDATE (duration_minutes, category_id) ON services TO pospay_app;
