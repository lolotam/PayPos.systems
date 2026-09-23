-- Last-owner protection (ADR-0003 §5.3, plan v4 T9a-4): a company that had an owner never commits without one.
-- An owner is a user membership in the system Owner role (id fixed in access-catalog.ts) at company scope that has
-- started and is open-ended. Ending it (even in the future), delaying its start, narrowing it to a business or branch,
-- demoting it or deleting it all count as removing an owner.
-- The trigger is deferred: a transaction may swap owners in any order and is checked once, at commit. The check is
-- serialised per company, so two transactions that each remove a different owner cannot both see the other's
-- still-uncommitted owner and commit together (READ COMMITTED gives the waiting check a fresh snapshot).
CREATE FUNCTION assert_company_keeps_an_owner() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pospay:company-owners:' || OLD.company_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE company_id = OLD.company_id
      AND role_id = '01920000-0000-7000-8000-000000000101' AND role_owner_key = 'global'
      AND user_id IS NOT NULL
      AND scope_type = 'COMPANY' AND scope_id = company_id
      AND starts_at <= now() AND ends_at IS NULL
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
        AND OLD.user_id IS NOT NULL)
  EXECUTE FUNCTION assert_company_keeps_an_owner();
