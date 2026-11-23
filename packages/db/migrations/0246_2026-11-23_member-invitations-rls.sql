-- RLS و Grants لجدول دعوات الأعضاء (G1) — على نفس نمط جداول الـ tenant التانية (0244).
-- الجدول فيه بصمة الإيميل المدعوّ وعمود الدور والنطاق فقط: مفيش توكن ولا رابط ولا إيميل صريح.
ALTER TABLE member_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE member_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_invitations_select ON member_invitations FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY member_invitations_insert ON member_invitations FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY member_invitations_update ON member_invitations FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON member_invitations FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON member_invitations TO pospay_app;
