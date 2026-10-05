-- Custom SQL migration file, put your code below! --
ALTER TABLE employee_document_expiry_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_document_expiry_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_document_expiry_notices_select ON employee_document_expiry_notices FOR SELECT TO pospay_app USING(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY employee_document_expiry_notices_insert ON employee_document_expiry_notices FOR INSERT TO pospay_app WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
-- دفتر منع التكرار يُكتب مرة ولا يُعدّل ولا يُحذف؛ تكرار الإشعار ممنوع بقيد فريد.
GRANT SELECT, INSERT ON employee_document_expiry_notices TO pospay_app;
