-- قيود الكبح بتُضاف NOT VALID عشان الهجرة ما تفحصش الدفاتر تحت قفل تقيل؛ والتحقق في 0170.
-- عمود نوع الكبح بيتضاف جنب suppressed_at: مفيش سطر مكبوح قبل هذه الهجرة، فمفيش بيانات تُرحّل ولا تُكتب.
ALTER TABLE "attendance_break_not_returned_notices" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD COLUMN "suppressed_kind" text;--> statement-breakpoint
ALTER TABLE "attendance_not_clocked_in_notices" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_suppressed" CHECK ("attendance_break_not_returned_notices"."suppressed_at" IS NULL OR "attendance_break_not_returned_notices"."recipient_count" = 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_suppressed_kind" CHECK ("attendance_break_not_returned_notices"."suppressed_kind" IN ('NOT_RETURNED', 'RETURNED_OTHER_BRANCH')) NOT VALID;--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" ADD CONSTRAINT "attendance_break_not_returned_notices_suppressed_pair" CHECK (("attendance_break_not_returned_notices"."suppressed_at" IS NULL) = ("attendance_break_not_returned_notices"."suppressed_kind" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "attendance_not_clocked_in_notices" ADD CONSTRAINT "attendance_not_clocked_in_notices_suppressed" CHECK ("attendance_not_clocked_in_notices"."suppressed_at" IS NULL OR "attendance_not_clocked_in_notices"."recipient_count" = 0) NOT VALID;
