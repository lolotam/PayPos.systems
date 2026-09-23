-- cashier_pins — tenant data (ADR-0003 §4 path B, §4.2). RLS on company_id like every tenant table. No DELETE grant:
-- a PIN is replaced, never removed, and a departed employee is stopped by ending their memberships, not by losing a
-- hash. The PIN itself is never stored — only its salted PBKDF2 hash, made in packages/auth.
ALTER TABLE cashier_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cashier_pins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY cashier_pins_select ON cashier_pins FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY cashier_pins_insert ON cashier_pins FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY cashier_pins_update ON cashier_pins FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cashier_pins TO pospay_app;
