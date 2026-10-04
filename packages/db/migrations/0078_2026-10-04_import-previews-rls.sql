-- Custom SQL migration file, put your code below! --
ALTER TABLE import_previews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_previews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_previews_select ON import_previews FOR SELECT TO pospay_app USING(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY import_previews_insert ON import_previews FOR INSERT TO pospay_app WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
CREATE POLICY import_previews_update ON import_previews FOR UPDATE TO pospay_app USING(company_id=app_company_id()) WITH CHECK(company_id=app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON import_previews TO pospay_app;
--> statement-breakpoint
-- الاستهلاك وحده يعدل المعاينة (committed_at)؛ الصفوف والأخطاء والانتهاء تبقى كما حُسبت.
GRANT UPDATE(committed_at) ON import_previews TO pospay_app;
