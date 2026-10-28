-- Custom SQL migration file, put your code below! --
GRANT UPDATE (opted_out_at, updated_at) ON customers TO pospay_app;
--> statement-breakpoint
CREATE POLICY customers_update ON customers FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- الرفض من التقييم اتجاه واحد بقرار المالك (RT-Q10)، والحراسة في القاعدة مش في الكود: أي دور بيكتب يرجّع العميل لازم يترفض.
CREATE FUNCTION customers_opt_out_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.opted_out_at IS NOT NULL AND NEW.opted_out_at IS DISTINCT FROM OLD.opted_out_at THEN
    RAISE EXCEPTION 'the opt-out of a customer is one-way' USING ERRCODE = '23514', CONSTRAINT = 'customers_opt_out_one_way';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customers_opt_out_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customers_opt_out_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER customers_opt_out_guard BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION customers_opt_out_guard();
