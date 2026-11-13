-- التحقق في ملف مستقل عشان 0223 يضيف القيدين NOT VALID من غير فحص الجدول تحت قفل ADD COLUMN.
-- VALIDATE بيمسك SHARE UPDATE EXCLUSIVE بس، فالكتابة تفضل شغالة أثناء فحص الصفوف الموجودة.
ALTER TABLE "services" VALIDATE CONSTRAINT "services_closed_marker_requires_closed";
--> statement-breakpoint
ALTER TABLE "services" VALIDATE CONSTRAINT "services_closed_marker_is_category";
