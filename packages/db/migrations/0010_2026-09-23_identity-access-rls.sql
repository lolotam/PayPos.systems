-- Access control RLS and grants — ADR-0003 §2.2, §2.3, §3; plan v4 T9a-2.
-- Every policy reads context through app_company_id() / app_user_id() (migration 0000); policies are split by
-- command, and INSERT / UPDATE declare WITH CHECK explicitly. The privilege suite fails on any grant not listed.

-- permissions: the catalogue, seeded from code by seedReferenceData. No RLS; the app reads it and nothing more.
GRANT SELECT ON permissions TO pospay_app;
--> statement-breakpoint

-- roles and role_permissions mix system rows (company_id IS NULL) and a company's own rows. A tenant reads
-- both but writes only its own: a system row never satisfies the mutation policies, so it cannot be changed,
-- re-homed into a company or deleted (§2.3).
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_select ON roles FOR SELECT TO pospay_app
  USING (company_id IS NULL OR company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY roles_insert ON roles FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY roles_update ON roles FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY roles_delete ON roles FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO pospay_app;
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT TO pospay_app
  USING (company_id IS NULL OR company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY role_permissions_update ON role_permissions FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO pospay_app;
--> statement-breakpoint

-- memberships: the bridge (§2.2). The user branch lets a just-authenticated user list their own memberships under
-- withUser(); the company branch lets a company administer its members under withTenant(). Writes are always
-- company-scoped — nobody changes a membership outside the current company, not even their own elsewhere.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT TO pospay_app
  USING (user_id = app_user_id() OR company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO pospay_app;
--> statement-breakpoint

-- permission_overrides: same shape as memberships. An override has no user_id of its own; the user branch reaches
-- it through its membership, which that user can already see.
ALTER TABLE permission_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE permission_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY permission_overrides_select ON permission_overrides FOR SELECT TO pospay_app
  USING (
    company_id = app_company_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.company_id = permission_overrides.company_id
        AND m.id = permission_overrides.membership_id
        AND m.user_id = app_user_id()
    )
  );
--> statement-breakpoint
CREATE POLICY permission_overrides_insert ON permission_overrides FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY permission_overrides_update ON permission_overrides FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY permission_overrides_delete ON permission_overrides FOR DELETE TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON permission_overrides TO pospay_app;
