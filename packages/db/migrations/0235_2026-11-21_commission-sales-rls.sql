-- الفهارس بتبدأ الملف زي 0209: الـ runner بينفّذ بادئة CONCURRENTLY خارج المعاملة،
-- وجملة CONCURRENTLY بعد جملة معاملة بترفض، فهي مش هتلاقي مكانها في ملف الجداول.
CREATE INDEX CONCURRENTLY "commission_sales_branch_idx" ON "commission_sales" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "commission_sales_seller_period_idx" ON "commission_sales" USING btree ("company_id","business_id","seller_employee_id","period");
--> statement-breakpoint
-- الـ RLS والمنح في ملف مستقل عن الجداول زي 0209: حماية المستأجر إجبارية على كل الأدوار،
-- وما فيش DELETE ولا منح لدور تاني ولا لـ PUBLIC.
ALTER TABLE commission_sales ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_sales FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_sales_select ON commission_sales FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_sales_insert ON commission_sales FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_sales_update ON commission_sales FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_sales FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_sales TO pospay_app;
--> statement-breakpoint
-- التعديل محصور في أعمدة الحدث المشتقّة؛ هوية الشركة والبيع والنشاط وهوية الصف ما بتتعدلش بالصلاحية،
-- فالمراجعة الأقدر ما تنقلش البيع لنشاط تاني ولا تغيّر هوية الصف (CM-20).
GRANT UPDATE (branch_id, seller_employee_id, business_date, period, price_paid, refunded_amount, status, revision) ON commission_sales TO pospay_app;
