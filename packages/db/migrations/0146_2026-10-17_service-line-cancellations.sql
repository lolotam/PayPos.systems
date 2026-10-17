-- CREATE TRIGGER يأخذ SHARE ROW EXCLUSIVE على service_lines وline_performers؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "service_line_cancellations" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision" integer NOT NULL,
	"previous_price" numeric(14, 3) NOT NULL,
	"previous_discount" numeric(14, 3) NOT NULL,
	"previous_net" numeric(14, 3) NOT NULL,
	"cancelled_by" uuid NOT NULL,
	"cancelled_by_membership_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"canceller_name_ar" text,
	"canceller_name_en" text,
	"canceller_role" text,
	"canceller_role_is_system" boolean,
	"canceller_role_name_ar" text,
	"canceller_role_name_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slc_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "slc_line_uq" UNIQUE("company_id","line_id"),
	CONSTRAINT "slc_revision_ck" CHECK ("service_line_cancellations"."previous_revision" >= 1 AND "service_line_cancellations"."revision" = "service_line_cancellations"."previous_revision" + 1),
	CONSTRAINT "slc_previous_amounts_ck" CHECK ("service_line_cancellations"."previous_price" >= 0 AND "service_line_cancellations"."previous_price" <= 99999999999.999 AND "service_line_cancellations"."previous_discount" BETWEEN 0 AND "service_line_cancellations"."previous_price" AND "service_line_cancellations"."previous_net" = "service_line_cancellations"."previous_price" - "service_line_cancellations"."previous_discount"),
	CONSTRAINT "slc_reason_ck" CHECK ("service_line_cancellations"."reason" = btrim("service_line_cancellations"."reason", chr(9) || chr(10) || chr(13) || chr(32)) AND char_length("service_line_cancellations"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "slc_canceller_names_ck" CHECK ("service_line_cancellations"."canceller_name_ar" IS NULL OR "service_line_cancellations"."canceller_name_en" IS NOT NULL),
	CONSTRAINT "slc_canceller_role_ck" CHECK ("service_line_cancellations"."canceller_role" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "slc_canceller_role_snapshot_ck" CHECK (("service_line_cancellations"."canceller_role" IS NULL) = ("service_line_cancellations"."canceller_role_is_system" IS NULL) AND ("service_line_cancellations"."canceller_role" IS NULL) = ("service_line_cancellations"."canceller_role_name_en" IS NULL) AND ("service_line_cancellations"."canceller_role_name_ar" IS NULL OR "service_line_cancellations"."canceller_role_name_en" IS NOT NULL)),
	CONSTRAINT "slc_canceller_identity_ck" CHECK ("service_line_cancellations"."canceller_name_en" IS NOT NULL OR "service_line_cancellations"."canceller_role" IS NOT NULL),
	CONSTRAINT "slc_canceller_lengths_ck" CHECK (char_length("service_line_cancellations"."canceller_name_ar") <= 255 AND char_length("service_line_cancellations"."canceller_name_en") <= 255 AND char_length("service_line_cancellations"."canceller_role_name_ar") <= 255 AND char_length("service_line_cancellations"."canceller_role_name_en") <= 255)
);
--> statement-breakpoint
ALTER TABLE "service_line_cancellations" ADD CONSTRAINT "slc_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_cancellations" ADD CONSTRAINT "slc_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_cancellations" ADD CONSTRAINT "slc_membership_fk" FOREIGN KEY ("company_id","cancelled_by","cancelled_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_cancellations" ADD CONSTRAINT "slc_actor_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slc_line_fk_idx" ON "service_line_cancellations" USING btree ("company_id","business_id","line_id");--> statement-breakpoint
CREATE INDEX "slc_membership_idx" ON "service_line_cancellations" USING btree ("company_id","cancelled_by","cancelled_by_membership_id");--> statement-breakpoint
CREATE INDEX "slc_actor_idx" ON "service_line_cancellations" USING btree ("cancelled_by");
--> statement-breakpoint
ALTER TABLE service_line_cancellations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_cancellations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_line_cancellations_select ON service_line_cancellations FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_line_cancellations_insert ON service_line_cancellations FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_line_cancellations FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_line_cancellations TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status) ON service_lines TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION service_lines_cancel_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'a service line is recorded ACTIVE' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_cancel_guard';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'a cancelled service line is frozen' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_cancel_guard';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'ACTIVE' OR NEW.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION 'a service line status changes only from ACTIVE to CANCELLED' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_cancel_guard';
  END IF;
  IF NEW.revision::bigint IS DISTINCT FROM OLD.revision::bigint + 1 THEN
    RAISE EXCEPTION 'cancelling a service line advances revision by one' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_cancel_guard';
  END IF;
  IF (to_jsonb(OLD) - 'status' - 'revision') IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'revision') THEN
    RAISE EXCEPTION 'cancelling a service line changes only status and revision' USING ERRCODE = '23514', CONSTRAINT = 'service_lines_cancel_guard';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- FOR UPDATE بلا ترقية قفل: FOR SHARE ثم UPDATE على نفس السطر يعلق معاملتين حتى 40P01، والقفل الحصري يتسلسل مع إلغاء متزامن. تحديث line_performers غير ممنوح لأي دور تشغيل؛ تحديث يدوي من المالك متزامن مع تغيير مؤدٍ قد ينتهي بـ deadlock مكتشف (معاملة واحدة ترجع) لا بحالة خاطئة.
CREATE FUNCTION line_performers_cancel_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE parent_status text;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    SELECT l.status INTO parent_status FROM public.service_lines l
    WHERE l.company_id = OLD.company_id AND l.business_id = OLD.business_id AND l.id = OLD.line_id
    FOR UPDATE;
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    ELSIF parent_status = 'CANCELLED' THEN
      RAISE EXCEPTION 'a cancelled service line accepts no performer change' USING ERRCODE = '23514', CONSTRAINT = 'line_performers_cancel_guard';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.company_id IS DISTINCT FROM NEW.company_id
    OR OLD.business_id IS DISTINCT FROM NEW.business_id OR OLD.line_id IS DISTINCT FROM NEW.line_id)) THEN
    SELECT l.status INTO parent_status FROM public.service_lines l
    WHERE l.company_id = NEW.company_id AND l.business_id = NEW.business_id AND l.id = NEW.line_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF parent_status = 'CANCELLED' THEN
      RAISE EXCEPTION 'a cancelled service line accepts no performer change' USING ERRCODE = '23514', CONSTRAINT = 'line_performers_cancel_guard';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION slc_validate_line(tenant uuid, business uuid, line uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_lines l
    JOIN public.service_line_cancellations c
      ON c.company_id = l.company_id AND c.business_id = l.business_id AND c.line_id = l.id
    WHERE l.company_id = slc_validate_line.tenant AND l.business_id = slc_validate_line.business AND l.id = slc_validate_line.line
      AND l.status = 'CANCELLED'
      AND l.revision IS NOT DISTINCT FROM c.revision
      AND c.previous_revision::bigint IS NOT DISTINCT FROM l.revision::bigint - 1
      AND c.previous_price IS NOT DISTINCT FROM l.price
      AND c.previous_discount IS NOT DISTINCT FROM l.discount
      AND c.previous_net IS NOT DISTINCT FROM l.net
  ) THEN
    RAISE EXCEPTION 'cancellation does not match the cancelled line' USING ERRCODE = '23514', CONSTRAINT = 'slc_complete';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION slc_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'service_lines' THEN
    PERFORM public.slc_validate_line(NEW.company_id, NEW.business_id, NEW.id);
  ELSE
    PERFORM public.slc_validate_line(NEW.company_id, NEW.business_id, NEW.line_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION service_lines_cancel_guard(), line_performers_cancel_guard(), slc_validate_line(uuid, uuid, uuid), slc_complete() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION service_lines_cancel_guard(), line_performers_cancel_guard(), slc_validate_line(uuid, uuid, uuid), slc_complete() TO pospay_app;
--> statement-breakpoint
-- بند ملغي مجمّد لكل كاتب، بما فيه المالك؛ صفوف 44/46 تخزن العكس والاسترداد في جداولها لا كعلامة على service_lines.
CREATE TRIGGER service_lines_cancel_guard BEFORE INSERT OR UPDATE ON service_lines
FOR EACH ROW EXECUTE FUNCTION service_lines_cancel_guard();
--> statement-breakpoint
CREATE TRIGGER line_performers_cancel_guard BEFORE INSERT OR UPDATE OR DELETE ON line_performers
FOR EACH ROW EXECUTE FUNCTION line_performers_cancel_guard();
--> statement-breakpoint
-- الاقتران بالحالة فقط بلا ختم معاملة: صف الإلغاء يبقى مطابقاً لنسخة السطر وأرقامه بعد الاستعادة.
CREATE CONSTRAINT TRIGGER service_lines_cancel_complete AFTER UPDATE ON service_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION slc_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER slc_complete AFTER INSERT ON service_line_cancellations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slc_complete();
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('cancel:service-lines:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'cancel:service-lines:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager', 'branch_manager')
ON CONFLICT DO NOTHING;