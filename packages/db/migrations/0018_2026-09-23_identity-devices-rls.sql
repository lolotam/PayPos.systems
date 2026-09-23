-- devices — tenant data (ADR-0003 §2.4, §4 path B). RLS on company_id like every tenant table; no DELETE grant: a
-- device is revoked, never deleted, so its history (who approved it, who revoked it, when) stays. A forged company in
-- a device token finds no row, because RLS hides every other company's devices.
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY devices_select ON devices FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY devices_insert ON devices FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY devices_update ON devices FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON devices TO pospay_app;
