-- Last-owner protection (ADR-0003 §5.3, plan v4 T9a-4): a company that had an owner never commits without one.
-- An owner is an open-ended user membership in the system Owner role (id fixed in access-catalog.ts). An owner
-- membership given an end date counts as leaving, so a future-dated demotion cannot expire the last owner later.
-- The trigger is deferred: a transaction may swap owners in any order and is checked once, at commit.
CREATE FUNCTION assert_company_keeps_an_owner() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE company_id = OLD.company_id
      AND role_id = '01920000-0000-7000-8000-000000000101' AND role_owner_key = 'global'
      AND user_id IS NOT NULL AND ends_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a company must keep at least one owner'
      USING ERRCODE = 'P0001', HINT = 'pospay:last-owner';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER memberships_keep_an_owner
  AFTER UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.role_id = '01920000-0000-7000-8000-000000000101' AND OLD.role_owner_key = 'global'
        AND OLD.user_id IS NOT NULL AND OLD.ends_at IS NULL)
  EXECUTE FUNCTION assert_company_keeps_an_owner();
