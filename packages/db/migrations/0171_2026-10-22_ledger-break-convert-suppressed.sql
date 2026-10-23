-- سطر الكبح في دفتر البريك بيتحوّل مرة واحدة لإشعار «رجعت لفرع آخر» أو يتقفل بنوع تاني؛ التحديث مسموح على الأعمدة دي بس.
GRANT UPDATE ("suppressed_at", "suppressed_kind", "recipient_count", "alert_due_at", "notified_at") ON attendance_break_not_returned_notices TO pospay_app;
--> statement-breakpoint
CREATE POLICY attendance_break_not_returned_notices_convert ON attendance_break_not_returned_notices FOR UPDATE TO pospay_app USING (company_id = app_company_id() AND suppressed_kind = 'NOT_RETURNED') WITH CHECK (company_id = app_company_id() AND (suppressed_at IS NULL OR suppressed_kind = 'RETURNED_OTHER_BRANCH'));
