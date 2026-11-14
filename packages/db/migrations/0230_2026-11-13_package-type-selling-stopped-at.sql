-- 33b (spec 058 FR-001…FR-003، PP-100.1): عمود حالة البيع، nullable بلا default فلا إعادة كتابة للجدول ولا backfill.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "package_types" ADD COLUMN "selling_stopped_at" timestamp with time zone;
--> statement-breakpoint
-- الإيقاف والاستئناف بيكتبوا العمود ده بس مع النسخة ووقت التعديل؛ pospay_app محتاج UPDATE عليه (والقفل FOR UPDATE يحتاج UPDATE على عمود).
GRANT UPDATE (selling_stopped_at) ON package_types TO pospay_app;
