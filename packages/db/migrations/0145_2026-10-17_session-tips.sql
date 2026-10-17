-- المفاتيح الأجنبية تقفل جداول حيّة؛ المهلة القصيرة تجعل الهجرة تفشل سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "session_tip_revisions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision" integer,
	"changed_by" uuid NOT NULL,
	"changed_by_membership_id" uuid NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"reason" text,
	"event_id" uuid NOT NULL,
	"write_xid" "xid8" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_tip_revisions_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "session_tip_revisions_session_revision_uq" UNIQUE("company_id","session_id","revision"),
	CONSTRAINT "session_tip_revisions_event_uq" UNIQUE("company_id","event_id"),
	CONSTRAINT "session_tip_revisions_business_session_id_uq" UNIQUE("company_id","business_id","session_id","id"),
	CONSTRAINT "session_tip_revisions_session_xid_uq" UNIQUE("company_id","session_id","write_xid"),
	CONSTRAINT "session_tip_revisions_revision_ck" CHECK (coalesce(("session_tip_revisions"."revision" = 1 AND "session_tip_revisions"."previous_revision" IS NULL) OR ("session_tip_revisions"."revision" >= 2 AND "session_tip_revisions"."previous_revision" = "session_tip_revisions"."revision" - 1), false)),
	CONSTRAINT "session_tip_revisions_reason_required_ck" CHECK ("session_tip_revisions"."revision" = 1 OR "session_tip_revisions"."reason" IS NOT NULL),
	CONSTRAINT "session_tip_revisions_reason_ck" CHECK ("session_tip_revisions"."reason" IS NULL OR ("session_tip_revisions"."reason" = btrim("session_tip_revisions"."reason", chr(9) || chr(10) || chr(13) || chr(32)) AND char_length("session_tip_revisions"."reason") BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "session_tips" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	CONSTRAINT "session_tips_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "session_tips_entry_uq" UNIQUE("company_id","revision_id","employee_id","method"),
	CONSTRAINT "session_tips_method_ck" CHECK ("session_tips"."method" IN ('CASH','CARD')),
	CONSTRAINT "session_tips_amount_ck" CHECK ("session_tips"."amount" > 0 AND "session_tips"."amount" <= 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE "session_tip_revisions" ADD CONSTRAINT "session_tip_revisions_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tip_revisions" ADD CONSTRAINT "session_tip_revisions_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tip_revisions" ADD CONSTRAINT "session_tip_revisions_previous_fk" FOREIGN KEY ("company_id","session_id","previous_revision") REFERENCES "public"."session_tip_revisions"("company_id","session_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tip_revisions" ADD CONSTRAINT "session_tip_revisions_membership_fk" FOREIGN KEY ("company_id","changed_by","changed_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tip_revisions" ADD CONSTRAINT "session_tip_revisions_actor_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tips" ADD CONSTRAINT "session_tips_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tips" ADD CONSTRAINT "session_tips_revision_fk" FOREIGN KEY ("company_id","business_id","session_id","revision_id") REFERENCES "public"."session_tip_revisions"("company_id","business_id","session_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tips" ADD CONSTRAINT "session_tips_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tips" ADD CONSTRAINT "session_tips_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_tip_revisions_membership_idx" ON "session_tip_revisions" USING btree ("company_id","changed_by","changed_by_membership_id");--> statement-breakpoint
CREATE INDEX "session_tip_revisions_actor_idx" ON "session_tip_revisions" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "session_tip_revisions_previous_idx" ON "session_tip_revisions" USING btree ("company_id","session_id","previous_revision");--> statement-breakpoint
CREATE INDEX "session_tips_session_revision_idx" ON "session_tips" USING btree ("company_id","business_id","session_id","revision_id");--> statement-breakpoint
CREATE INDEX "session_tips_employee_idx" ON "session_tips" USING btree ("company_id","business_id","employee_id");
--> statement-breakpoint
ALTER TABLE session_tip_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE session_tip_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE session_tips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE session_tips FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY session_tip_revisions_select ON session_tip_revisions FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY session_tip_revisions_insert ON session_tip_revisions FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY session_tips_select ON session_tips FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY session_tips_insert ON session_tips FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON session_tip_revisions, session_tips FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON session_tip_revisions, session_tips TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION session_tip_revisions_begin() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.write_xid := pg_current_xact_id();
  RETURN NEW;
END $$;
--> statement-breakpoint
-- صف شركة أخرى يُرفض بسياسة الإدراج؛ فحص الأب هنا كان سيخفي الرفض بكود قيد.
CREATE FUNCTION session_tips_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM public.app_company_id() THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.session_tip_revisions AS parent
    WHERE parent.company_id = NEW.company_id
      AND parent.id = NEW.revision_id
      AND parent.write_xid = pg_current_xact_id()
  ) THEN
    RAISE EXCEPTION 'tip revision is not part of this transaction'
      USING ERRCODE = '23514', CONSTRAINT = 'session_tips_current_xact';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION session_tip_revisions_begin(), session_tips_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION session_tip_revisions_begin(), session_tips_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER session_tip_revisions_begin BEFORE INSERT ON session_tip_revisions
FOR EACH ROW EXECUTE FUNCTION session_tip_revisions_begin();
--> statement-breakpoint
CREATE TRIGGER session_tips_insert_guard BEFORE INSERT ON session_tips
FOR EACH ROW EXECUTE FUNCTION session_tips_insert_guard();