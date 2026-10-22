-- التحقق بيحصل في معاملة لوحدها بعد ما 0169 يخلص، وبقفل SHARE UPDATE EXCLUSIVE بس.
ALTER TABLE "attendance_not_clocked_in_notices" VALIDATE CONSTRAINT "attendance_not_clocked_in_notices_suppressed";
--> statement-breakpoint
ALTER TABLE "attendance_break_not_returned_notices" VALIDATE CONSTRAINT "attendance_break_not_returned_notices_suppressed";
