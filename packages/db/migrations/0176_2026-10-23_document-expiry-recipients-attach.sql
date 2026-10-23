-- علامة إرفاق المستلمين بتتحول مرة واحدة من NULL إلى وقت الإرفاق؛ التحديث مسموح على العمود ده بس ولا يرجع لـ NULL.
GRANT UPDATE ("recipients_attached_at") ON employee_document_expiry_notices TO pospay_app;
--> statement-breakpoint
CREATE POLICY employee_document_expiry_notices_attach ON employee_document_expiry_notices FOR UPDATE TO pospay_app USING (company_id = app_company_id() AND recipients_attached_at IS NULL) WITH CHECK (company_id = app_company_id() AND recipients_attached_at IS NOT NULL);
