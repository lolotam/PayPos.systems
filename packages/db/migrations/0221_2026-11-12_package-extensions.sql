INSERT INTO permissions(code) VALUES ('extend:packages:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'extend:packages:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE "package_extensions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"previous_expires_on" date NOT NULL,
	"new_expires_on" date NOT NULL,
	"reason" text NOT NULL,
	"extended_by" uuid NOT NULL,
	"extended_by_membership_id" uuid NOT NULL,
	"extended_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_extensions_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_extensions_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "package_extensions_entitlement_previous_key" UNIQUE("company_id","entitlement_id","previous_expires_on"),
	CONSTRAINT "package_extensions_forward_check" CHECK ("package_extensions"."new_expires_on" > "package_extensions"."previous_expires_on"),
	CONSTRAINT "package_extensions_reason_check" CHECK (char_length("package_extensions"."reason") <= 500 AND btrim("package_extensions"."reason", chr(9) || chr(10) || chr(13) || chr(32)) <> '')
);
--> statement-breakpoint
ALTER TABLE "package_entitlements" ADD COLUMN "expires_on_changed_system_id" bigint;--> statement-breakpoint
ALTER TABLE "package_entitlements" ADD COLUMN "expires_on_changed_txid" "xid8";--> statement-breakpoint
ALTER TABLE "package_entitlements" ADD COLUMN "expires_on_before" date;--> statement-breakpoint
ALTER TABLE "package_extensions" ADD CONSTRAINT "package_extensions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extensions" ADD CONSTRAINT "package_extensions_entitlement_fk" FOREIGN KEY ("company_id","business_id","entitlement_id") REFERENCES "public"."package_entitlements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extensions" ADD CONSTRAINT "package_extensions_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extensions" ADD CONSTRAINT "package_extensions_extended_by_user_id_fk" FOREIGN KEY ("extended_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extensions" ADD CONSTRAINT "package_extensions_membership_fk" FOREIGN KEY ("company_id","extended_by","extended_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_extensions_branch_fk_idx" ON "package_extensions" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "package_extensions_extended_by_idx" ON "package_extensions" USING btree ("extended_by");--> statement-breakpoint
CREATE INDEX "package_extensions_membership_fk_idx" ON "package_extensions" USING btree ("company_id","extended_by","extended_by_membership_id");--> statement-breakpoint
CREATE INDEX "package_extensions_history_idx" ON "package_extensions" USING btree ("company_id","business_id","entitlement_id","extended_at");
--> statement-breakpoint
ALTER TABLE package_extensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_extensions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_extensions_select ON package_extensions FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_extensions_insert ON package_extensions FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON package_extensions FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_extensions TO pospay_app;
--> statement-breakpoint
-- ختم الإنشاء وختم التمديد مملوكان للتريغرات، حتى لا يزوّر المستدعي معاملة الإنشاء أو التمديد.
CREATE OR REPLACE FUNCTION package_entitlements_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  NEW.created_system_id := sid;
  NEW.created_txid := pg_current_xact_id();
  NEW.expires_on_changed_system_id := NULL;
  NEW.expires_on_changed_txid := NULL;
  NEW.expires_on_before := NULL;
  -- الاستحقاق بيبدأ نظيف: لا مسترد ولا نسخة تانية غير الأولى (BR-03).
  IF NEW.refunded_amount IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'an entitlement starts with no refunded amount'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_initial_refunded_amount';
  END IF;
  IF NEW.revision IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'an entitlement starts at revision one'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_initial_revision';
  END IF;
  -- سطر الاستيراد لازم يكون داخل معاينة استيراد باقات لنفس الشركة ونفس النشاط؛ مفيش FK عشان المعاينة بتتمسح بعد الاستيراد.
  IF NEW.import_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.import_previews p
    WHERE p.company_id = NEW.company_id
      AND p.business_id = NEW.business_id
      AND p.id = NEW.import_batch_id
      AND p.entity = 'packages'
  ) THEN
    RAISE EXCEPTION 'the imported entitlement names no packages preview of this business'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_import_preview';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- تاريخ الانتهاء يتقدم فقط وبسجل تمديد من نفس المعاملة؛ باقي أعمدة الاستحقاق تفضل مقفولة كما كانت.
CREATE OR REPLACE FUNCTION package_entitlements_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint;
BEGIN
  -- الختم ما بيتختمش تاني: بياخد من OLD عشان يفضل دليل معاملة الإنشاء (ADR-0050).
  NEW.created_system_id := OLD.created_system_id;
  NEW.created_txid := OLD.created_txid;
  IF NEW.expires_on IS DISTINCT FROM OLD.expires_on THEN
    IF NEW.expires_on < OLD.expires_on THEN
      RAISE EXCEPTION 'the expiry of an entitlement only moves forward'
        USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_expires_on_forward_only';
    END IF;
    sid := public.pospay_system_id();
    IF sid IS NULL OR sid = 0 THEN
      RAISE EXCEPTION 'the cluster system identifier is unavailable';
    END IF;
    IF OLD.expires_on_changed_system_id IS NOT DISTINCT FROM sid
      AND OLD.expires_on_changed_txid IS NOT DISTINCT FROM pg_current_xact_id() THEN
      RAISE EXCEPTION 'the expiry of an entitlement changes once per transaction'
        USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_expires_on_once';
    END IF;
    NEW.expires_on_changed_system_id := sid;
    NEW.expires_on_changed_txid := pg_current_xact_id();
    NEW.expires_on_before := OLD.expires_on;
  ELSE
    NEW.expires_on_changed_system_id := OLD.expires_on_changed_system_id;
    NEW.expires_on_changed_txid := OLD.expires_on_changed_txid;
    NEW.expires_on_before := OLD.expires_on_before;
  END IF;
  IF NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    RAISE EXCEPTION 'the refunded amount of an entitlement is closed until the refund row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_refunded_amount_closed';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'the revision of an entitlement is closed until the refund row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_revision_closed';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['expires_on','refunded_amount','revision','created_system_id','created_txid','expires_on_changed_system_id','expires_on_changed_txid','expires_on_before'])
     IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['expires_on','refunded_amount','revision','created_system_id','created_txid','expires_on_changed_system_id','expires_on_changed_txid','expires_on_before']) THEN
    RAISE EXCEPTION 'an entitlement changes only through its own transition'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- ممنوع يتغير تاريخ الانتهاء من غير سجل تمديد مطابق؛ الفحص عند الالتزام يسمح بترتيب الكتابة داخل المعاملة.
CREATE FUNCTION package_entitlements_extension_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint; v_entitlement public.package_entitlements%ROWTYPE;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  SELECT * INTO v_entitlement FROM public.package_entitlements e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.package_extensions x
    WHERE x.company_id = v_entitlement.company_id
      AND x.business_id = v_entitlement.business_id
      AND x.entitlement_id = v_entitlement.id
      AND x.previous_expires_on = v_entitlement.expires_on_before
      AND x.new_expires_on = v_entitlement.expires_on
  ) THEN
    RAISE EXCEPTION 'the expiry change has no matching extension row'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_extension_missing';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER package_entitlements_extension_complete
AFTER UPDATE OF expires_on ON package_entitlements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.expires_on IS DISTINCT FROM NEW.expires_on)
EXECUTE FUNCTION package_entitlements_extension_complete();
--> statement-breakpoint
-- ممنوع يسجل تمديد لم يغيّر الاستحقاق فعلاً في نفس المعاملة، حتى لا يظهر في التاريخ تمديد وهمي.
CREATE FUNCTION package_extensions_history_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint; v_entitlement public.package_entitlements%ROWTYPE;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  SELECT * INTO v_entitlement FROM public.package_entitlements e
  WHERE e.company_id = NEW.company_id AND e.business_id = NEW.business_id AND e.id = NEW.entitlement_id;
  IF NOT FOUND
    OR v_entitlement.expires_on_changed_system_id IS DISTINCT FROM sid
    OR v_entitlement.expires_on_changed_txid IS DISTINCT FROM pg_current_xact_id()
    OR v_entitlement.expires_on_before IS DISTINCT FROM NEW.previous_expires_on
    OR v_entitlement.expires_on IS DISTINCT FROM NEW.new_expires_on THEN
    RAISE EXCEPTION 'the extension row does not match the entitlement change'
      USING ERRCODE = '23514', CONSTRAINT = 'package_extensions_history_mismatch';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER package_extensions_history_complete
AFTER INSERT ON package_extensions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION package_extensions_history_complete();
--> statement-breakpoint
REVOKE ALL ON FUNCTION package_entitlements_extension_complete(), package_extensions_history_complete() FROM PUBLIC, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION package_entitlements_extension_complete(), package_extensions_history_complete() TO pospay_app;
