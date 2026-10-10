-- التحقق في ملف منفصل حتى يتحرر قفل ADD COLUMN قبل فحص الجدول (كل ملف ترحيل معاملة واحدة).
ALTER TABLE "staff_schedule_shifts" VALIDATE CONSTRAINT "staff_schedule_shifts_break_pair";
--> statement-breakpoint
ALTER TABLE "staff_schedule_shifts" VALIDATE CONSTRAINT "staff_schedule_shifts_break_inside";
