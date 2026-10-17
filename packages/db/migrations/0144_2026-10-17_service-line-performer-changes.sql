-- CREATE TRIGGER يأخذ SHARE ROW EXCLUSIVE؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "service_line_performer_change_rows" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"side" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"performer_ordinal" integer NOT NULL,
	"share_bps" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"linked_user_id" uuid,
	"linked_user_snapshotted" boolean NOT NULL,
	"not_clocked_in_warning" boolean NOT NULL,
	"approved_leave_warning" boolean NOT NULL,
	CONSTRAINT "slpcr_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "slpcr_employee_uq" UNIQUE("company_id","change_id","side","employee_id"),
	CONSTRAINT "slpcr_ordinal_uq" UNIQUE("company_id","change_id","side","performer_ordinal"),
	CONSTRAINT "slpcr_side_ck" CHECK ("service_line_performer_change_rows"."side" IN ('BEFORE','AFTER')),
	CONSTRAINT "slpcr_share_ordinal_ck" CHECK ("service_line_performer_change_rows"."share_bps" BETWEEN 1 AND 10000 AND "service_line_performer_change_rows"."performer_ordinal" BETWEEN 1 AND 4),
	CONSTRAINT "slpcr_snapshot_ck" CHECK ("service_line_performer_change_rows"."linked_user_id" IS NULL OR "service_line_performer_change_rows"."linked_user_snapshotted")
);
--> statement-breakpoint
CREATE TABLE "service_line_performer_changes" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision" integer NOT NULL,
	"reason" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_by_membership_id" uuid NOT NULL,
	"changer_name_ar" text,
	"changer_name_en" text,
	"changer_role" text,
	"changer_role_is_system" boolean,
	"changer_role_name_ar" text,
	"changer_role_name_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"write_xid" "xid8" NOT NULL,
	CONSTRAINT "slpc_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "slpc_line_revision_uq" UNIQUE("company_id","line_id","revision"),
	CONSTRAINT "slpc_business_id_uq" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "slpc_line_xid_uq" UNIQUE("company_id","line_id","write_xid"),
	CONSTRAINT "slpc_revision_ck" CHECK ("service_line_performer_changes"."previous_revision" >= 1 AND "service_line_performer_changes"."revision" = "service_line_performer_changes"."previous_revision" + 1),
	CONSTRAINT "slpc_reason_ck" CHECK ("service_line_performer_changes"."reason" = btrim("service_line_performer_changes"."reason", chr(9) || chr(10) || chr(13) || chr(32)) AND char_length("service_line_performer_changes"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "slpc_changer_names_ck" CHECK ("service_line_performer_changes"."changer_name_ar" IS NULL OR "service_line_performer_changes"."changer_name_en" IS NOT NULL),
	CONSTRAINT "slpc_changer_role_ck" CHECK ("service_line_performer_changes"."changer_role" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "slpc_changer_role_snapshot_ck" CHECK (("service_line_performer_changes"."changer_role" IS NULL) = ("service_line_performer_changes"."changer_role_is_system" IS NULL) AND ("service_line_performer_changes"."changer_role" IS NULL) = ("service_line_performer_changes"."changer_role_name_en" IS NULL) AND ("service_line_performer_changes"."changer_role_name_ar" IS NULL OR "service_line_performer_changes"."changer_role_name_en" IS NOT NULL)),
	CONSTRAINT "slpc_changer_identity_ck" CHECK ("service_line_performer_changes"."changer_name_en" IS NOT NULL OR "service_line_performer_changes"."changer_role" IS NOT NULL),
	CONSTRAINT "slpc_changer_lengths_ck" CHECK (char_length("service_line_performer_changes"."changer_name_ar") <= 255 AND char_length("service_line_performer_changes"."changer_name_en") <= 255 AND char_length("service_line_performer_changes"."changer_role_name_ar") <= 255 AND char_length("service_line_performer_changes"."changer_role_name_en") <= 255)
);
--> statement-breakpoint
ALTER TABLE "service_line_performer_change_rows" ADD CONSTRAINT "slpcr_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_change_rows" ADD CONSTRAINT "slpcr_change_fk" FOREIGN KEY ("company_id","business_id","change_id") REFERENCES "public"."service_line_performer_changes"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_change_rows" ADD CONSTRAINT "slpcr_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_change_rows" ADD CONSTRAINT "slpcr_user_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_changes" ADD CONSTRAINT "slpc_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_changes" ADD CONSTRAINT "slpc_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_changes" ADD CONSTRAINT "slpc_membership_fk" FOREIGN KEY ("company_id","changed_by","changed_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_performer_changes" ADD CONSTRAINT "slpc_actor_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slpcr_change_fk_idx" ON "service_line_performer_change_rows" USING btree ("company_id","business_id","change_id");--> statement-breakpoint
CREATE INDEX "slpcr_employee_idx" ON "service_line_performer_change_rows" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "slpcr_user_idx" ON "service_line_performer_change_rows" USING btree ("linked_user_id") WHERE "service_line_performer_change_rows"."linked_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "slpc_history_idx" ON "service_line_performer_changes" USING btree ("company_id","business_id","line_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "slpc_membership_idx" ON "service_line_performer_changes" USING btree ("company_id","changed_by","changed_by_membership_id");--> statement-breakpoint
CREATE INDEX "slpc_actor_idx" ON "service_line_performer_changes" USING btree ("changed_by");
--> statement-breakpoint
ALTER TABLE service_line_performer_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_performer_change_rows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_performer_change_rows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_line_performer_changes_select ON service_line_performer_changes FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_line_performer_changes_insert ON service_line_performer_changes FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_line_performer_change_rows_select ON service_line_performer_change_rows FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_line_performer_change_rows_insert ON service_line_performer_change_rows FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_line_performer_changes, service_line_performer_change_rows FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_line_performer_changes, service_line_performer_change_rows TO pospay_app;
--> statement-breakpoint
GRANT DELETE ON line_performers TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (has_performer_warning) ON service_lines TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION slpc_same_tuple(
  a_employee uuid, a_ordinal integer, a_share integer, a_user uuid, a_snapshotted boolean, a_name_en text, a_name_ar text, a_clock boolean, a_leave boolean,
  b_employee uuid, b_ordinal integer, b_share integer, b_user uuid, b_snapshotted boolean, b_name_en text, b_name_ar text, b_clock boolean, b_leave boolean
) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT ROW(a_employee, a_ordinal, a_share, a_user, a_snapshotted, a_name_en, a_name_ar, a_clock, a_leave)
    IS NOT DISTINCT FROM
    ROW(b_employee, b_ordinal, b_share, b_user, b_snapshotted, b_name_en, b_name_ar, b_clock, b_leave)
$$;
--> statement-breakpoint
CREATE FUNCTION slpc_side_shape_ok(tenant uuid, change_id uuid, which text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows r
    WHERE r.company_id = tenant AND r.change_id = slpc_side_shape_ok.change_id AND r.side = which
    HAVING count(*)::integer BETWEEN 1 AND 4
      AND coalesce(sum(r.share_bps), 0)::integer = 10000
      AND min(r.performer_ordinal) = 1
      AND max(r.performer_ordinal) = count(*)::integer)
$$;
--> statement-breakpoint
CREATE FUNCTION slpc_tuple_matches(tenant uuid, change_id uuid, which text, line uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
  SELECT (
    SELECT count(*) FROM public.service_line_performer_change_rows r
    WHERE r.company_id = tenant AND r.change_id = slpc_tuple_matches.change_id AND r.side = which
  ) = (
    SELECT count(*) FROM public.line_performers p
    WHERE p.company_id = tenant AND p.line_id = slpc_tuple_matches.line
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows r
    WHERE r.company_id = tenant AND r.change_id = slpc_tuple_matches.change_id AND r.side = which
      AND NOT EXISTS (
        SELECT 1 FROM public.line_performers p
        WHERE p.company_id = r.company_id AND p.line_id = slpc_tuple_matches.line
          AND public.slpc_same_tuple(
            r.employee_id, r.performer_ordinal, r.share_bps, r.linked_user_id, r.linked_user_snapshotted, r.name_en, r.name_ar, r.not_clocked_in_warning, r.approved_leave_warning,
            p.employee_id, p.performer_ordinal, p.share_bps, p.linked_user_id, p.linked_user_snapshotted, p.name_en, p.name_ar, p.not_clocked_in_warning, p.approved_leave_warning)))
  AND NOT EXISTS (
    SELECT 1 FROM public.line_performers p
    WHERE p.company_id = tenant AND p.line_id = slpc_tuple_matches.line
      AND NOT EXISTS (
        SELECT 1 FROM public.service_line_performer_change_rows r
        WHERE r.company_id = p.company_id AND r.change_id = slpc_tuple_matches.change_id AND r.side = which
          AND public.slpc_same_tuple(
            r.employee_id, r.performer_ordinal, r.share_bps, r.linked_user_id, r.linked_user_snapshotted, r.name_en, r.name_ar, r.not_clocked_in_warning, r.approved_leave_warning,
            p.employee_id, p.performer_ordinal, p.share_bps, p.linked_user_id, p.linked_user_snapshotted, p.name_en, p.name_ar, p.not_clocked_in_warning, p.approved_leave_warning)))
$$;
--> statement-breakpoint
CREATE FUNCTION slpc_validate_change(tenant uuid, change_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header record; line_rev integer;
BEGIN
  SELECT c.company_id, c.id, c.business_id, c.line_id, c.revision, c.write_xid INTO header
  FROM public.service_line_performer_changes c
  WHERE c.company_id = tenant AND c.id = slpc_validate_change.change_id;
  IF NOT FOUND OR header.write_xid IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'change header is not part of this transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  SELECT l.revision INTO line_rev FROM public.service_lines l
  WHERE l.company_id = header.company_id AND l.business_id = header.business_id AND l.id = header.line_id;
  IF line_rev IS DISTINCT FROM header.revision THEN
    RAISE EXCEPTION 'line is not at the change target revision' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF NOT public.slpc_side_shape_ok(tenant, header.id, 'BEFORE') OR NOT public.slpc_side_shape_ok(tenant, header.id, 'AFTER') THEN
    RAISE EXCEPTION 'performer change sides are not a valid set' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF NOT public.slpc_tuple_matches(tenant, header.id, 'AFTER', header.line_id) THEN
    RAISE EXCEPTION 'after side does not match the live performers' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows b
    JOIN public.service_line_performer_change_rows a
      ON a.company_id = b.company_id AND a.change_id = b.change_id AND a.employee_id = b.employee_id AND a.side = 'AFTER'
    WHERE b.company_id = tenant AND b.change_id = header.id AND b.side = 'BEFORE'
      AND (a.linked_user_id IS DISTINCT FROM b.linked_user_id OR a.linked_user_snapshotted IS DISTINCT FROM b.linked_user_snapshotted)
  ) THEN
    RAISE EXCEPTION 'kept performer snapshot identity changed' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows a
    WHERE a.company_id = tenant AND a.change_id = header.id AND a.side = 'AFTER' AND NOT a.linked_user_snapshotted
      AND NOT EXISTS (
        SELECT 1 FROM public.service_line_performer_change_rows b
        WHERE b.company_id = a.company_id AND b.change_id = a.change_id AND b.side = 'BEFORE' AND b.employee_id = a.employee_id)
  ) THEN
    RAISE EXCEPTION 'new performer was not snapshotted' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_change_rows b
    WHERE b.company_id = tenant AND b.change_id = header.id AND b.side = 'BEFORE' AND NOT b.linked_user_snapshotted
      AND NOT EXISTS (
        SELECT 1 FROM public.service_line_performer_change_rows a
        WHERE a.company_id = b.company_id AND a.change_id = b.change_id AND a.side = 'AFTER' AND a.employee_id = b.employee_id)
  ) THEN
    RAISE EXCEPTION 'removed performer was not snapshotted' USING ERRCODE = '23514', CONSTRAINT = 'slpc_complete';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION slpc_change_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header uuid;
BEGIN
  IF TG_TABLE_NAME = 'service_line_performer_changes' THEN
    PERFORM public.slpc_validate_change(NEW.company_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'service_line_performer_change_rows' THEN
    PERFORM public.slpc_validate_change(NEW.company_id, NEW.change_id);
  ELSIF TG_OP = 'DELETE' THEN
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    WHERE c.company_id = OLD.company_id AND c.line_id = OLD.line_id AND c.write_xid = pg_current_xact_id();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'deleting a performer requires a change header at the line target revision'
        USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
    END IF;
    PERFORM public.slpc_validate_change(OLD.company_id, header);
  ELSE
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    WHERE c.company_id = NEW.company_id AND c.line_id = NEW.line_id AND c.write_xid = pg_current_xact_id();
    IF FOUND THEN PERFORM public.slpc_validate_change(NEW.company_id, header); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION slpc_begin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE line_rev integer;
BEGIN
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_line_performer_changes c
    WHERE c.company_id = NEW.company_id AND c.line_id = NEW.line_id AND c.write_xid = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'only one performer change per line per transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpc_one_line_per_xact';
  END IF;
  SELECT l.revision INTO line_rev FROM public.service_lines l
  WHERE l.company_id = NEW.company_id AND l.business_id = NEW.business_id AND l.id = NEW.line_id
  FOR UPDATE;
  IF NOT FOUND OR line_rev IS DISTINCT FROM NEW.previous_revision THEN
    RAISE EXCEPTION 'line revision does not match the change previous revision' USING ERRCODE = '23514', CONSTRAINT = 'slpc_begin';
  END IF;
  NEW.write_xid := pg_current_xact_id();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION slpcr_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prev integer; target integer; line_rev integer;
BEGIN
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  SELECT c.previous_revision, c.revision, l.revision INTO prev, target, line_rev
  FROM public.service_line_performer_changes c
  JOIN public.service_lines l ON l.company_id = c.company_id AND l.business_id = c.business_id AND l.id = c.line_id
  WHERE c.company_id = NEW.company_id AND c.business_id = NEW.business_id AND c.id = NEW.change_id
    AND c.write_xid = pg_current_xact_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'side row parent is not a change header of this transaction' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_current_xact';
  END IF;
  IF NEW.side = 'BEFORE' AND line_rev IS DISTINCT FROM prev THEN
    RAISE EXCEPTION 'before rows are closed once the line revision moves' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_side_window';
  ELSIF NEW.side = 'AFTER' AND line_rev IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'after rows open only at the target revision' USING ERRCODE = '23514', CONSTRAINT = 'slpcr_side_window';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION service_lines_performer_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header record;
BEGIN
  SELECT c.id, c.previous_revision, c.revision INTO header
  FROM public.service_line_performer_changes c
  WHERE c.company_id = OLD.company_id AND c.line_id = OLD.id AND c.write_xid = pg_current_xact_id();
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF OLD.revision IS DISTINCT FROM header.previous_revision OR NEW.revision IS DISTINCT FROM header.revision THEN
    RAISE EXCEPTION 'service line revision does not match the change header' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  IF to_jsonb(OLD) - 'revision' - 'has_performer_warning' IS DISTINCT FROM to_jsonb(NEW) - 'revision' - 'has_performer_warning' THEN
    RAISE EXCEPTION 'a performer change may only update revision and has_performer_warning' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  IF NOT public.slpc_side_shape_ok(OLD.company_id, header.id, 'BEFORE')
    OR NOT public.slpc_tuple_matches(OLD.company_id, header.id, 'BEFORE', OLD.id) THEN
    RAISE EXCEPTION 'before side does not match the live performers' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_performer_transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION line_performers_change_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE header uuid; line_rev integer; target integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN OLD; END IF;
    SELECT c.id INTO header FROM public.service_line_performer_changes c
    JOIN public.service_lines l ON l.company_id = c.company_id AND l.business_id = c.business_id AND l.id = c.line_id
    WHERE c.company_id = OLD.company_id AND c.line_id = OLD.line_id AND c.write_xid = pg_current_xact_id() AND l.revision = c.revision;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.service_line_performer_change_rows r
      WHERE r.company_id = OLD.company_id AND r.change_id = header AND r.side = 'BEFORE'
        AND public.slpc_same_tuple(
          r.employee_id, r.performer_ordinal, r.share_bps, r.linked_user_id, r.linked_user_snapshotted, r.name_en, r.name_ar, r.not_clocked_in_warning, r.approved_leave_warning,
          OLD.employee_id, OLD.performer_ordinal, OLD.share_bps, OLD.linked_user_id, OLD.linked_user_snapshotted, OLD.name_en, OLD.name_ar, OLD.not_clocked_in_warning, OLD.approved_leave_warning)
    ) THEN
      RAISE EXCEPTION 'deleting a performer requires a change header at the line target revision'
        USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN RETURN NEW; END IF;
  SELECT l.revision, c.revision INTO line_rev, target
  FROM public.service_lines l
  LEFT JOIN public.service_line_performer_changes c
    ON c.company_id = l.company_id AND c.business_id = l.business_id AND c.line_id = l.id AND c.write_xid = pg_current_xact_id()
  WHERE l.company_id = NEW.company_id AND l.business_id = NEW.business_id AND l.id = NEW.line_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF target IS NOT NULL AND line_rev IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'performer insert requires the line to be at the change target revision'
      USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
  END IF;
  IF target IS NULL AND line_rev IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'recording performers after revision 1 requires a change header'
      USING ERRCODE = '23514', CONSTRAINT = 'line_performers_change_guard';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  slpc_same_tuple(uuid, integer, integer, uuid, boolean, text, text, boolean, boolean, uuid, integer, integer, uuid, boolean, text, text, boolean, boolean),
  slpc_side_shape_ok(uuid, uuid, text),
  slpc_tuple_matches(uuid, uuid, text, uuid),
  slpc_validate_change(uuid, uuid),
  slpc_change_complete(),
  slpc_begin(),
  slpcr_insert_guard(),
  service_lines_performer_transition(),
  line_performers_change_guard()
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  slpc_same_tuple(uuid, integer, integer, uuid, boolean, text, text, boolean, boolean, uuid, integer, integer, uuid, boolean, text, text, boolean, boolean),
  slpc_side_shape_ok(uuid, uuid, text),
  slpc_tuple_matches(uuid, uuid, text, uuid),
  slpc_validate_change(uuid, uuid),
  slpc_change_complete(),
  slpc_begin(),
  slpcr_insert_guard(),
  service_lines_performer_transition(),
  line_performers_change_guard()
TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER slpc_begin BEFORE INSERT ON service_line_performer_changes
FOR EACH ROW EXECUTE FUNCTION slpc_begin();
--> statement-breakpoint
CREATE TRIGGER slpcr_insert_guard BEFORE INSERT ON service_line_performer_change_rows
FOR EACH ROW EXECUTE FUNCTION slpcr_insert_guard();
--> statement-breakpoint
CREATE TRIGGER service_lines_performer_transition BEFORE UPDATE ON service_lines
FOR EACH ROW EXECUTE FUNCTION service_lines_performer_transition();
--> statement-breakpoint
-- مطابقة الصف المحذوف بصف BEFORE، لا المجموعة الحية كلها: الحذف المتعدد ينقص المجموعة قبل الصف التالي، ومطابقة المجموعة الكاملة تمت عند CAS.
CREATE TRIGGER line_performers_change_guard BEFORE INSERT OR DELETE ON line_performers
FOR EACH ROW EXECUTE FUNCTION line_performers_change_guard();
--> statement-breakpoint
-- الفحص المؤجّل يفشل مغلقاً لو أُجبر قبل اكتمال الكتابة؛ الكاتب الشرعي يتركه لآخر المعاملة.
CREATE CONSTRAINT TRIGGER slpc_complete AFTER INSERT ON service_line_performer_changes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slpc_change_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER slpcr_complete AFTER INSERT ON service_line_performer_change_rows
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slpc_change_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER line_performers_change_complete AFTER INSERT OR DELETE ON line_performers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slpc_change_complete();
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('change:service-line-performers:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'change:service-line-performers:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager', 'branch_manager')
ON CONFLICT DO NOTHING;