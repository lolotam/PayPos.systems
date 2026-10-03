CREATE FUNCTION employee_branches_close_once() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD."to" IS NOT NULL OR NEW."to" IS NULL THEN
    RAISE EXCEPTION 'employee branch history is close-only'
      USING ERRCODE = '23514', CONSTRAINT = 'employee_branches_close_once';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION employee_branches_close_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER employee_branches_close_once BEFORE UPDATE ON employee_branches
  FOR EACH ROW EXECUTE FUNCTION employee_branches_close_once();
