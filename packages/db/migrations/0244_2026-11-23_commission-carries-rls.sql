-- الـ RLS والمنح في ملف مستقل عن الجدول زي 0232/0233: حماية المستأجر إجبارية على كل الأدوار.
-- جدول المرحّلات للإضافة والقراءة بس (D-22): ما فيش UPDATE ولا DELETE ولا منح لدور تاني ولا لـ PUBLIC.
ALTER TABLE commission_carries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_carries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_carries_select ON commission_carries FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_carries_insert ON commission_carries FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_carries FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_carries TO pospay_app;
