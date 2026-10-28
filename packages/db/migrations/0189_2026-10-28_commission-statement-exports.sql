CREATE TABLE "commission_statement_exports" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"render_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_membership_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"branch_ids" uuid[],
	"employee_ids" uuid[],
	"language" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone,
	CONSTRAINT "commission_statement_exports_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_exports_render_key" UNIQUE("company_id","render_id"),
	CONSTRAINT "commission_statement_exports_period" CHECK ("commission_statement_exports"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_statement_exports"."period", 1, 4) <> '0000'),
	CONSTRAINT "commission_statement_exports_scope" CHECK ("commission_statement_exports"."scope" IN ('BUSINESS','BRANCHES')),
	CONSTRAINT "commission_statement_exports_language" CHECK ("commission_statement_exports"."language" IN ('ar','en')),
	CONSTRAINT "commission_statement_exports_scope_arrays" CHECK (("commission_statement_exports"."scope" = 'BUSINESS' AND "commission_statement_exports"."branch_ids" IS NULL AND "commission_statement_exports"."employee_ids" IS NULL)
        OR ("commission_statement_exports"."scope" = 'BRANCHES' AND "commission_statement_exports"."branch_ids" IS NOT NULL AND "commission_statement_exports"."employee_ids" IS NOT NULL
          AND cardinality("commission_statement_exports"."branch_ids") > 0)),
	CONSTRAINT "commission_statement_exports_branch_ids_elements" CHECK (array_position("commission_statement_exports"."branch_ids", NULL::uuid) IS NULL),
	CONSTRAINT "commission_statement_exports_employee_ids_elements" CHECK (array_position("commission_statement_exports"."employee_ids", NULL::uuid) IS NULL)
);
--> statement-breakpoint
ALTER TABLE "commission_statement_exports" ADD CONSTRAINT "commission_statement_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_exports" ADD CONSTRAINT "commission_statement_exports_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_exports" ADD CONSTRAINT "commission_statement_exports_statement_fk" FOREIGN KEY ("company_id","business_id","period","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","period","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_exports" ADD CONSTRAINT "commission_statement_exports_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_exports" ADD CONSTRAINT "commission_statement_exports_membership_fk" FOREIGN KEY ("company_id","requested_by","requested_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statement_exports_statement_idx" ON "commission_statement_exports" USING btree ("company_id","business_id","period","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_exports_requester_idx" ON "commission_statement_exports" USING btree ("company_id","requested_by","requested_at");--> statement-breakpoint
CREATE INDEX "commission_statement_exports_membership_idx" ON "commission_statement_exports" USING btree ("company_id","requested_by","requested_membership_id");--> statement-breakpoint
CREATE INDEX "commission_statement_exports_requested_by_idx" ON "commission_statement_exports" USING btree ("requested_by");
--> statement-breakpoint
ALTER TABLE commission_statement_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statement_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_exports_select ON commission_statement_exports FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_exports_insert ON commission_statement_exports FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_exports_update ON commission_statement_exports FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON commission_statement_exports FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_statement_exports TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (collected_at) ON commission_statement_exports TO pospay_app;
--> statement-breakpoint
-- حارس الإدراج: شبكة أمان لفحص حالة الكشف في مسار الاستخدام، فالتصدير ما ينفعش إلا لكشف معتمد أو مدفوع (CS-Q10).
CREATE FUNCTION commission_statement_exports_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  statement_status text;
BEGIN
  SELECT s.status
    INTO statement_status
    FROM public.commission_statements s
   WHERE s.company_id = NEW.company_id AND s.id = NEW.statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the statement of an export request does not exist' USING ERRCODE = '23503', CONSTRAINT = 'commission_statement_exports_statement_fk';
  END IF;
  IF statement_status IS DISTINCT FROM 'APPROVED' AND statement_status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION 'an export request takes an approved or a paid statement only' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_exports_insert_guard';
  END IF;
  IF NEW.collected_at IS NOT NULL THEN
    RAISE EXCEPTION 'an export request is not collected on insert' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_exports_not_collected';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statement_exports_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statement_exports_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statement_exports_insert_guard BEFORE INSERT ON commission_statement_exports
FOR EACH ROW EXECUTE FUNCTION commission_statement_exports_insert_guard();
--> statement-breakpoint
-- حارس التحديث: الطلب بيتجمّع مرة واحدة بس (CM-55e)، فبعد وقت التحميل ما يتغيّرش أي عمود تاني.
CREATE FUNCTION commission_statement_exports_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.render_id IS DISTINCT FROM OLD.render_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.statement_id IS DISTINCT FROM OLD.statement_id
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_membership_id IS DISTINCT FROM OLD.requested_membership_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.branch_ids IS DISTINCT FROM OLD.branch_ids
     OR NEW.employee_ids IS DISTINCT FROM OLD.employee_ids
     OR NEW.language IS DISTINCT FROM OLD.language
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'an export request changes only its collection time' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_exports_immutable';
  END IF;
  IF NOT (OLD.collected_at IS NULL AND NEW.collected_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an export request is collected once' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_exports_collect_once';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statement_exports_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statement_exports_update_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statement_exports_update_guard BEFORE UPDATE ON commission_statement_exports
FOR EACH ROW EXECUTE FUNCTION commission_statement_exports_update_guard();