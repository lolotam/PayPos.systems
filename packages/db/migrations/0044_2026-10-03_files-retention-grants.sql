-- owner decision 2026-10-03: اعمدة دورة الاحتفاظ فقط؛ لا منح ادوار ولا صلاحية DELETE.
GRANT UPDATE (confirmed_at, rejected_at, purge_started_at, purged_at) ON file_objects TO pospay_app;
--> statement-breakpoint
UPDATE file_objects SET confirmed_at = created_at WHERE status IN ('VERIFYING','READY','REJECTED') AND confirmed_at IS NULL;
--> statement-breakpoint
-- تحفظ المرفوضات السابقة سبعة ايام كاملة من تطبيق القرار لغياب وقت رفض قديم موثوق.
UPDATE file_objects SET rejected_at = CURRENT_TIMESTAMP WHERE status = 'REJECTED' AND rejected_at IS NULL;
