-- 46-1: تخزين استرداد جلسات الباقة (spec 058، شريحة 46-1).
-- توسّع بس: جدولان جديدان، عمود إعداد واحد، صلاحية جديدة، وفتح انتقال الحرة ← المستردة والمبلغ المسترد.
-- كل فحوص السلاسل المالية مؤجلة لحد ما المعاملة تخلص، عشان ترتيب الكتابة في حالة الاستخدام ما يبقش غلط.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- صلاحية استرداد الباقات: نفس مديري التمديد الأربعة، والجهاز ممنوع منها (PK-Q16).
INSERT INTO permissions(code) VALUES ('refund:packages:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'refund:packages:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- إعداد النشاط: استرداد الباقات المستوردة؛ null = مقفول، والبيع ما بيقراش الإعداد ده (FR-053، RF-08).
ALTER TABLE business_settings ADD COLUMN imported_refunds_enabled boolean;
--> statement-breakpoint
-- سطر الاسترداد: صف واحد لكل استرداد جلسات من مكوّن واحد. الصف ثابت مالوش تعديل ولا حذف، والعكس سطر جديد.
CREATE TABLE "package_refunds" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sessions" integer NOT NULL,
	"amount" numeric(14,3) NOT NULL,
	"method" text NOT NULL,
	"reason" text NOT NULL,
	"refunded_by" uuid NOT NULL,
	"refunded_by_membership_id" uuid NOT NULL,
	"refunded_at" timestamp with time zone NOT NULL,
	"entitlement_revision" integer NOT NULL,
	CONSTRAINT "package_refunds_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_refunds_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "package_refunds_entitlement_revision_key" UNIQUE("company_id","entitlement_id","entitlement_revision"),
	CONSTRAINT "package_refunds_sessions_check" CHECK ("sessions" BETWEEN 1 AND 365),
	CONSTRAINT "package_refunds_amount_check" CHECK ("amount" BETWEEN 0 AND 99999999999.999),
	CONSTRAINT "package_refunds_method_check" CHECK ("method" IN ('CASH','CARD')),
	-- شرط السبب نفسه بتاع 0221 (package_extensions_reason_check): سطر لازم، وطوله 500 حرف على الأكثر.
	CONSTRAINT "package_refunds_reason_check" CHECK (char_length("reason") <= 500 AND btrim("reason", chr(9) || chr(10) || chr(13) || chr(32)) <> ''),
	CONSTRAINT "package_refunds_entitlement_revision_check" CHECK ("entitlement_revision" >= 2)
);
--> statement-breakpoint
-- سطر لكل جلسة مستردة: جلسة واحدة اتستردت مرة واحدة بس في كل الشركة (unique على slot_id).
CREATE TABLE "package_refund_slots" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"unit_value" numeric(14,3) NOT NULL,
	CONSTRAINT "package_refund_slots_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_refund_slots_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "package_refund_slots_slot_key" UNIQUE("company_id","slot_id"),
	CONSTRAINT "package_refund_slots_ordinal_check" CHECK ("ordinal" >= 1),
	CONSTRAINT "package_refund_slots_unit_value_check" CHECK ("unit_value" BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_entitlement_fk" FOREIGN KEY ("company_id","business_id","entitlement_id") REFERENCES "public"."package_entitlements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_component_fk" FOREIGN KEY ("company_id","business_id","entitlement_id","component_id") REFERENCES "public"."package_components"("company_id","business_id","entitlement_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refunds" ADD CONSTRAINT "package_refunds_membership_fk" FOREIGN KEY ("company_id","refunded_by","refunded_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refund_slots" ADD CONSTRAINT "package_refund_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refund_slots" ADD CONSTRAINT "package_refund_slots_refund_fk" FOREIGN KEY ("company_id","business_id","refund_id") REFERENCES "public"."package_refunds"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refund_slots" ADD CONSTRAINT "package_refund_slots_component_fk" FOREIGN KEY ("company_id","business_id","entitlement_id","component_id") REFERENCES "public"."package_components"("company_id","business_id","entitlement_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_refund_slots" ADD CONSTRAINT "package_refund_slots_slot_fk" FOREIGN KEY ("company_id","business_id","slot_id") REFERENCES "public"."package_session_slots"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- كل مفتاح أجنبي ليه فهرس بعموده بالترتيب بالظبط، عشان فحص الفهارس يعدّي (CLAUDE.md §5).
CREATE INDEX "package_refunds_entitlement_fk_idx" ON "package_refunds" USING btree ("company_id","business_id","entitlement_id");
--> statement-breakpoint
CREATE INDEX "package_refunds_component_fk_idx" ON "package_refunds" USING btree ("company_id","business_id","entitlement_id","component_id");
--> statement-breakpoint
CREATE INDEX "package_refunds_branch_fk_idx" ON "package_refunds" USING btree ("company_id","business_id","branch_id");
--> statement-breakpoint
CREATE INDEX "package_refunds_refunded_by_idx" ON "package_refunds" USING btree ("refunded_by");
--> statement-breakpoint
CREATE INDEX "package_refunds_membership_fk_idx" ON "package_refunds" USING btree ("company_id","refunded_by","refunded_by_membership_id");
--> statement-breakpoint
CREATE INDEX "package_refund_slots_refund_fk_idx" ON "package_refund_slots" USING btree ("company_id","business_id","refund_id");
--> statement-breakpoint
CREATE INDEX "package_refund_slots_component_fk_idx" ON "package_refund_slots" USING btree ("company_id","business_id","entitlement_id","component_id");
--> statement-breakpoint
CREATE INDEX "package_refund_slots_slot_fk_idx" ON "package_refund_slots" USING btree ("company_id","business_id","slot_id");
--> statement-breakpoint
-- العزل: شركة واحدة بس تشوف صفوفها، والكتابة مش بتعدّي حدود الشركة (CLAUDE.md §5).
ALTER TABLE package_refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_refunds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_refunds_select ON package_refunds FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_refunds_insert ON package_refunds FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON package_refunds FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_refunds TO pospay_app;
--> statement-breakpoint
ALTER TABLE package_refund_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_refund_slots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_refund_slots_select ON package_refund_slots FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_refund_slots_insert ON package_refund_slots FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON package_refund_slots FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_refund_slots TO pospay_app;
--> statement-breakpoint
-- الانتقالات المسموحة بالظبط: الحرة والمستخدمُة تتبادل، والحرة بس بتتحول مستردة (TD-5b).
-- أي حالة تانية (مستردة أو مستوردة مستعملة) نهائية، والحرة ما بتستردش وهي ماسكة استرداد.
CREATE OR REPLACE FUNCTION public.package_session_slots_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (
    (OLD.state IN ('FREE','USED') AND NEW.state IN ('FREE','USED'))
    OR (OLD.state = 'FREE' AND NEW.state = 'REFUNDED' AND OLD.current_redemption_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'terminal and refund transitions remain closed' USING ERRCODE='23514', CONSTRAINT='package_session_slots_state_closed';
  END IF;
  IF NEW.current_redemption_id IS DISTINCT FROM OLD.current_redemption_id
    AND NEW.state NOT IN ('FREE','USED') THEN
    RAISE EXCEPTION 'the redemption of a session is closed until the redemption row exists' USING ERRCODE='23514', CONSTRAINT='package_session_slots_redemption_closed';
  END IF;
  IF (to_jsonb(OLD) - 'state' - 'current_redemption_id') IS DISTINCT FROM
     (to_jsonb(NEW) - 'state' - 'current_redemption_id') THEN
    RAISE EXCEPTION 'slot identity and value are immutable' USING ERRCODE='23514', CONSTRAINT='package_session_slots_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- تاريخ الانتهاء بيتقدم فقط وبسجل تمديد من نفس المعاملة؛ باقي أعمدة الاستحقاق تفضل مقفولة كما كانت.
CREATE OR REPLACE FUNCTION public.package_entitlements_update_guard() RETURNS trigger
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
  -- المبلغ المسترد بيزيد بس ومش يعدّي السعر المدفوع؛ سطر الاسترداد هو اللي بيثبّت الأرقام دي (BR-03).
  IF NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    IF NEW.refunded_amount < OLD.refunded_amount OR NEW.refunded_amount > NEW.price_paid THEN
      RAISE EXCEPTION 'the refunded amount of an entitlement only grows and never passes the price paid'
        USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_refunded_amount_bounds';
    END IF;
  END IF;
  -- تغيّر المبلغ أو النسخة لازم يبقى بنسخة واحدة زيادة بالظبط، والاسترداد بيفرض كمان (TD-15 a).
  IF NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount OR NEW.revision IS DISTINCT FROM OLD.revision THEN
    IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
      RAISE EXCEPTION 'the revision of an entitlement moves exactly one step with every refund'
        USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_revision_step';
    END IF;
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
-- فحص الاسترداد: بيقرأ الحالة الحالية بس ومفيش ختم معاملة يتزور، وبيمسك الاستحقاق بقفله.
-- بيفشل مقفول لو المسترد أو استحقاقه مش موجودين (تصميم 46-1).
-- فحوص سطور المسترد كلها set-based: تمرّة واحدة بتجمّع العدد والمجموع والمخالفات مع بعض، والربط
-- بالمفتاح الأساسي (company_id,id) عشان كل سطر يلاقي جلسته بلمسة فهرس واحدة.
-- تريغر الصف (package_refund_slots_complete) اتشال: المرجع الغايب بتمسكه المفاتيح الأجنبية فورًا،
-- وباقي الفحوص بتغطيها دالة المسترد دي والتريغر الفوري لحد الجلسات.
--
-- الفحص اتقسم لجزأين: جزء الاستحقاق (رخيص) وجزء السطور (غالي، تمرّة على كل سطر مسترد).
-- تريغر الاستحقاق بياخد جزء الاستحقاق بس، عشان فحص السطور يبقى مرّة واحدة لكل استرداد.
-- دالة package_refund_validate لسه بتعمل الاتنين بالترتيب ده، فالنتيجة زي ما هي.
--
-- جزء الاستحقاق: بيقرأ سطر الاسترداد وبيقفل الاستحقاق، وبعدين بيقارن حصيلة المستردات
-- بالمبلغ المسترد وبالنسخة (BR-03). ده الجزء اللي بيرفض أي استرداد ماشي مع القاعدة دي.
CREATE OR REPLACE FUNCTION public.package_refund_validate_entitlement(p_company uuid, p_refund uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_refund public.package_refunds%ROWTYPE;
  v_entitlement public.package_entitlements%ROWTYPE;
  v_total numeric(14,3);
  v_count integer;
  v_max_revision integer;
BEGIN
  SELECT * INTO v_refund FROM public.package_refunds
    WHERE company_id = p_company AND id = p_refund;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the refund is missing or hidden' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  SELECT * INTO v_entitlement FROM public.package_entitlements e
    WHERE e.company_id = v_refund.company_id AND e.id = v_refund.entitlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the entitlement of the refund is missing or hidden' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  -- حصيلة الاستحقاق: مجموع المستردات = المبلغ المسترد، والنسخة = واحد + عدد المستردات (BR-03).
  SELECT coalesce(sum(r.amount), 0), count(*), coalesce(max(r.entitlement_revision), 0)
    INTO v_total, v_count, v_max_revision
    FROM public.package_refunds r
    WHERE r.company_id = v_refund.company_id AND r.business_id = v_refund.business_id
      AND r.entitlement_id = v_refund.entitlement_id;
  IF v_entitlement.refunded_amount IS DISTINCT FROM v_total
    OR v_entitlement.revision IS DISTINCT FROM v_count + 1
    OR v_max_revision IS DISTINCT FROM v_entitlement.revision THEN
    RAISE EXCEPTION 'the refunded amount or the revision of the entitlement does not match its refunds'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  IF v_refund.entitlement_revision > v_entitlement.revision THEN
    RAISE EXCEPTION 'the refund carries a revision above the revision of its entitlement'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
END $$;
--> statement-breakpoint
-- جزء السطور: تمرّة واحدة set-based على سطور المسترد بتجمّع عددها ومجموع قيمها ومخالفاتها
-- (استحقاق أو مكوّن غلط، قيم منسوخة من جلسة تانية، جلسة لسه مش مستردة). ده أبطأ جزء في
-- فحص الاسترداد كله، وهو اللي اتقسم عشان ما يتكررش في تريغر الاستحقاق.
CREATE OR REPLACE FUNCTION public.package_refund_validate_slots(p_company uuid, p_refund uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_refund public.package_refunds%ROWTYPE;
  v_slots integer;
  v_slots_total numeric(14,3);
  v_mismatch integer;
  v_copied integer;
  v_state integer;
BEGIN
  SELECT * INTO v_refund FROM public.package_refunds
    WHERE company_id = p_company AND id = p_refund;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the refund is missing or hidden' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  -- سطور المسترد: عددها = عدد الجلسات المستردة، ومجموع قيمها = المبلغ المسترد.
  -- تمرّة واحدة على سطور المسترد بتجمّع العدد والمجموع ومخالفات الاستحقاق والمكوّن والنسخ والحالة.
  SELECT count(*), coalesce(sum(rs.unit_value), 0),
    count(*) FILTER (WHERE rs.entitlement_id IS DISTINCT FROM v_refund.entitlement_id
      OR rs.component_id IS DISTINCT FROM v_refund.component_id),
    count(*) FILTER (WHERE s.id IS NOT NULL AND s.business_id = rs.business_id
      AND (rs.entitlement_id IS DISTINCT FROM s.entitlement_id
        OR rs.component_id IS DISTINCT FROM s.component_id
        OR rs.ordinal IS DISTINCT FROM s.ordinal
        OR rs.unit_value IS DISTINCT FROM s.unit_value)),
    count(*) FILTER (WHERE s.id IS NOT NULL AND s.business_id = rs.business_id AND s.state <> 'REFUNDED')
    INTO v_slots, v_slots_total, v_mismatch, v_copied, v_state
    FROM public.package_refund_slots rs
    LEFT JOIN public.package_session_slots s
      ON s.company_id = rs.company_id AND s.id = rs.slot_id
    WHERE rs.company_id = v_refund.company_id AND rs.business_id = v_refund.business_id
      AND rs.refund_id = v_refund.id;
  IF v_slots IS DISTINCT FROM v_refund.sessions OR v_slots_total IS DISTINCT FROM v_refund.amount THEN
    RAISE EXCEPTION 'the sessions or the amount of the refund do not match its refund slots'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  -- كل سطر مسترد لازم يكون من استحقاق المسترد نفسه ومن نفس المكوّن بتاعه.
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'a refund slot names another entitlement or another component'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_entitlement_mismatch';
  END IF;
  -- الترقيم وقيمة الجلسة لازم يكونوا نسخة من الجلسة نفسها، مش أرقام تانية.
  IF v_copied > 0 THEN
    RAISE EXCEPTION 'a refund slot copies the values of another session'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  -- الجلسة اللي في سطر المسترد لازم تكون مستردة فعلاً.
  IF v_state > 0 THEN
    RAISE EXCEPTION 'a refund slot names a session that is not refunded'
      USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_slot_state';
  END IF;
END $$;
--> statement-breakpoint
-- الفحص كامل: جزء الاستحقاق الأول وبعده جزء السطور، بنفس ترتيب الدالة القديمة وبنفس الرسائل.
CREATE OR REPLACE FUNCTION public.package_refund_validate(p_company uuid, p_refund uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.package_refund_validate_entitlement(p_company, p_refund);
  PERFORM public.package_refund_validate_slots(p_company, p_refund);
END $$;
--> statement-breakpoint
-- التريغر المؤجل للاستحقاق: نسخة الاستحقاق لازم يكون ليها سطر مسترد، والمسترد بيتفحص كله مرة واحدة.
CREATE OR REPLACE FUNCTION public.package_refund_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_refund uuid;
BEGIN
  IF TG_TABLE_NAME = 'package_refunds' THEN
    PERFORM public.package_refund_validate(NEW.company_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'package_entitlements' THEN
    SELECT r.id INTO v_refund FROM public.package_refunds r
      WHERE r.company_id = NEW.company_id AND r.entitlement_id = NEW.id AND r.entitlement_revision = NEW.revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the revision of the entitlement has no refund row' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
    END IF;
    -- التريغر ده بيفحص جزء الاستحقاق بس: سطور المسترد ما بتتغيرش بعد ما تتكتب (مفيش صلاحية
    -- تعديل ولا حذف، وحالة المستردة نهائية)، وسطر الاسترداد اللي اتكتب في نفس المعاملة بيتفحص
    -- كله مرّة واحدة في package_refunds_complete. يعني إعادة فحص السطور من هنا شغل مكرر بس.
    PERFORM public.package_refund_validate_entitlement(NEW.company_id, v_refund);
  ELSE
    RAISE EXCEPTION 'the refund check does not know this table' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_integrity';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- فحص الجلسة اللي اتستردت: لازم يكون ليها سطر في جدول سطور المسترد؛ من غير تجميع ومن غير نداء دالة المسترد.
CREATE OR REPLACE FUNCTION public.package_refund_slot_state_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.package_refund_slots rs
    WHERE rs.company_id = NEW.company_id AND rs.slot_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'the refunded session has no refund slot row' USING ERRCODE = '23514', CONSTRAINT = 'package_refunds_slot_missing';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- الفحص الفوري: سطور المسترد ما يقدرش تتعدّى عدد الجلسات اللي المسترد بيقولها، قبل أي فحص مؤجل.
-- سطور الحركة بتتجمّع مرة واحدة لكل استرداد، والعد بيتعمل مرة واحدة لكل استرداد مش مرة لكل سطر.
CREATE OR REPLACE FUNCTION public.package_refund_slots_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT n.company_id, n.refund_id
      FROM new_refund_slots n
      GROUP BY n.company_id, n.refund_id
    ) g
    JOIN public.package_refunds r
      ON r.company_id = g.company_id AND r.id = g.refund_id
    WHERE (
      SELECT count(*) FROM public.package_refund_slots rs
      WHERE rs.company_id = g.company_id AND rs.business_id = r.business_id AND rs.refund_id = g.refund_id
    ) > r.sessions
  ) THEN
    RAISE EXCEPTION 'the refund has more sessions than it claims' USING ERRCODE = '23514', CONSTRAINT = 'package_refund_slots_over_sessions';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER package_refunds_complete
AFTER INSERT ON package_refunds DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.package_refund_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER package_session_slots_refund_complete
AFTER UPDATE OF state ON package_session_slots DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.state = 'REFUNDED' AND OLD.state IS DISTINCT FROM 'REFUNDED')
EXECUTE FUNCTION public.package_refund_slot_state_complete();
--> statement-breakpoint
-- المستردة نهائية وبتيجي من الحرة بلا مؤشر استرداد، وفحص الاسترداد نفسه بيغطي الاتجاه التاني؛
-- فحص FOR UPDATE لكل جلسة كان بيكلّف حوالي 120 ms مع 365 جلسة مستردة.
DROP TRIGGER package_session_slots_redemption_complete ON package_session_slots;
CREATE CONSTRAINT TRIGGER package_session_slots_redemption_complete AFTER UPDATE OF state, current_redemption_id ON public.package_session_slots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN ((OLD.state IS DISTINCT FROM NEW.state OR OLD.current_redemption_id IS DISTINCT FROM NEW.current_redemption_id) AND NEW.state <> 'REFUNDED')
  EXECUTE FUNCTION public.package_redemption_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER package_entitlements_refund_complete
AFTER UPDATE OF refunded_amount, revision ON package_entitlements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.refunded_amount IS DISTINCT FROM NEW.refunded_amount OR OLD.revision IS DISTINCT FROM NEW.revision)
EXECUTE FUNCTION public.package_refund_complete();
--> statement-breakpoint
CREATE TRIGGER package_refund_slots_sessions_guard
AFTER INSERT ON package_refund_slots
REFERENCING NEW TABLE AS new_refund_slots FOR EACH STATEMENT
EXECUTE FUNCTION public.package_refund_slots_sessions_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.package_session_slots_update_guard(), public.package_entitlements_update_guard(),
  public.package_refund_validate(uuid,uuid), public.package_refund_validate_entitlement(uuid,uuid),
  public.package_refund_validate_slots(uuid,uuid), public.package_refund_complete(),
  public.package_refund_slot_state_complete(),
  public.package_refund_slots_sessions_guard() FROM PUBLIC, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.package_session_slots_update_guard(), public.package_entitlements_update_guard(),
  public.package_refund_validate(uuid,uuid), public.package_refund_validate_entitlement(uuid,uuid),
  public.package_refund_validate_slots(uuid,uuid), public.package_refund_complete(),
  public.package_refund_slot_state_complete(),
  public.package_refund_slots_sessions_guard() TO pospay_app;
