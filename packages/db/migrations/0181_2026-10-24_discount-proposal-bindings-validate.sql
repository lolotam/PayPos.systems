-- التحقق من قيود D-21 بيحصل في معاملة لوحدها بعد ما الهجرة السابقة تخلص: SHARE UPDATE EXCLUSIVE على الجدول المفحوص وROW SHARE على الجدول المرجوع، فالكتابة بتكمّل.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "service_lines" VALIDATE CONSTRAINT "service_lines_discount_proposal_binding_fk";
--> statement-breakpoint
ALTER TABLE "discount_proposals" VALIDATE CONSTRAINT "dp_consumed_line_session_fk";
--> statement-breakpoint
ALTER TABLE "discount_proposals" VALIDATE CONSTRAINT "dp_session_branch_fk";
