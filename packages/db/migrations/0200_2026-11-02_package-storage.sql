-- تخزين بيع الباقات (spec 058، شريحة 42-2): الاستحقاق (بيع أو استيراد) ومكوّناته وجلساته.
-- القاعدة اللي بتمسك السطر كله: الاستحقاق بيتختم بختم الإنشاء، ومكوّناته وجلساته لازم تيجي في نفس المعاملة.
-- أي تحريك للأرقام (expires_on، refunded_amount، revision) أو لحالة الجلسة مقفول هنا، لحد ما هجرات 43-1 و45 و46-1 تفتحه.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- الاستحقاق: صف واحد لكل باقة مباعة أو مستوردة.
-- المفتاح الأساسي (company_id, id) عشان صف شركة مايتشافش من شركة تانية (ADR-0007)، والمفتاح (company_id, business_id, id)
-- هو اللي بتستند عليه المفاتيح الأجنبية المجهّزة بالنشاط.
CREATE TABLE package_entitlements (
  company_id uuid NOT NULL,
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  -- نوع الباقة null في الاستيراد: المصدر ملف مش الكتالوج (FR-062).
  package_type_id uuid,
  provenance text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  validity_days integer,
  list_price numeric(14,3),
  price_paid numeric(14,3) NOT NULL,
  discount numeric(14,3),
  discount_bps integer,
  paid_method text,
  seller_employee_id uuid,
  seller_linked_user_id uuid,
  sold_branch_id uuid,
  sold_at timestamptz,
  sold_business_date date,
  sold_timezone text,
  late boolean NOT NULL DEFAULT false,
  recorded_by uuid NOT NULL,
  recorded_by_membership_id uuid NOT NULL,
  external_ref text,
  import_batch_id uuid,
  import_row integer,
  expires_on date NOT NULL,
  refunded_amount numeric(14,3) NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ختم الإنشاء: مش بتوعنا نكتبهم؛ التريغر بيكتبهم وبيستبدل أي قيمة جاية من المستدعي (ADR-0050).
  created_system_id bigint NOT NULL,
  created_txid xid8 NOT NULL,
  CONSTRAINT package_entitlements_pkey PRIMARY KEY (company_id, id),
  CONSTRAINT package_entitlements_business_id_key UNIQUE (company_id, business_id, id),
  -- المرجع الخارجي فريد على مستوى الشركة؛ الصفوف اللي external_ref فيها null مش بتتعارض (FR-066).
  CONSTRAINT package_entitlements_external_ref_key UNIQUE (company_id, external_ref),
  CONSTRAINT package_entitlements_provenance_check CHECK (provenance IN ('SOLD','IMPORTED')),
  -- البيع لازم يحدّد كل حاجة: النوع، البائع، طريقة الدفع، الفرع، لحظة البيع وتاريخه ومنطقته، والمدة والأسعار.
  CONSTRAINT package_entitlements_sold_shape_check CHECK (
    provenance <> 'SOLD' OR (
      package_type_id IS NOT NULL AND seller_employee_id IS NOT NULL AND paid_method IS NOT NULL
      AND sold_branch_id IS NOT NULL AND sold_at IS NOT NULL AND sold_business_date IS NOT NULL
      AND sold_timezone IS NOT NULL AND validity_days IS NOT NULL AND list_price IS NOT NULL
      AND discount IS NOT NULL AND discount_bps IS NOT NULL
      AND external_ref IS NULL AND import_batch_id IS NULL AND import_row IS NULL
    )
  ),
  -- الاستيراد مالوش نوع ولا بائع ولا طريقة دفع ولا تاريخ بيع؛ ومصدره الملف لا غير (FR-060…FR-065).
  CONSTRAINT package_entitlements_imported_shape_check CHECK (
    provenance <> 'IMPORTED' OR (
      package_type_id IS NULL AND seller_employee_id IS NULL
      AND seller_linked_user_id IS NULL AND paid_method IS NULL AND sold_business_date IS NULL
      AND external_ref IS NOT NULL AND import_batch_id IS NOT NULL AND import_row IS NOT NULL
      AND import_row BETWEEN 1 AND 500
    )
  ),
  -- الفلوس بالدينار وثلاث خانات؛ NaN مش داخل المدى ده فرفضته.
  CONSTRAINT package_entitlements_price_paid_check CHECK (price_paid BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_entitlements_list_price_check CHECK (list_price IS NULL OR list_price BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_entitlements_discount_check CHECK (discount IS NULL OR discount BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_entitlements_refunded_amount_check CHECK (refunded_amount BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_entitlements_discount_bps_check CHECK (discount_bps IS NULL OR discount_bps BETWEEN 0 AND 10000),
  CONSTRAINT package_entitlements_paid_method_check CHECK (paid_method IS NULL OR paid_method IN ('CASH','CARD')),
  CONSTRAINT package_entitlements_external_ref_check CHECK (external_ref IS NULL OR char_length(external_ref) BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies (id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_customer_fk
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_package_type_fk
  FOREIGN KEY (company_id, business_id, package_type_id) REFERENCES package_types (company_id, business_id, id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_seller_employee_fk
  FOREIGN KEY (company_id, business_id, seller_employee_id) REFERENCES employees (company_id, business_id, id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_seller_user_fk
  FOREIGN KEY (seller_linked_user_id) REFERENCES "user" (id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_sold_branch_fk
  FOREIGN KEY (company_id, business_id, sold_branch_id) REFERENCES branches (company_id, business_id, id);
--> statement-breakpoint
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_recorder_fk
  FOREIGN KEY (recorded_by) REFERENCES "user" (id);
--> statement-breakpoint
-- العضوية مرتبطة بالمستخدم نفسه: مستحيل استحقاق ينسب لمستخدم تاني من نفس الشركة.
ALTER TABLE package_entitlements ADD CONSTRAINT package_entitlements_recorder_membership_fk
  FOREIGN KEY (company_id, recorded_by, recorded_by_membership_id) REFERENCES memberships (company_id, user_id, id);
--> statement-breakpoint
CREATE INDEX package_entitlements_customer_fk_idx ON package_entitlements (company_id, customer_id);
--> statement-breakpoint
CREATE INDEX package_entitlements_package_type_fk_idx ON package_entitlements (company_id, business_id, package_type_id) WHERE package_type_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX package_entitlements_seller_employee_fk_idx ON package_entitlements (company_id, business_id, seller_employee_id) WHERE seller_employee_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX package_entitlements_seller_user_fk_idx ON package_entitlements (seller_linked_user_id) WHERE seller_linked_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX package_entitlements_sold_branch_fk_idx ON package_entitlements (company_id, business_id, sold_branch_id) WHERE sold_branch_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX package_entitlements_recorder_fk_idx ON package_entitlements (recorded_by);
--> statement-breakpoint
CREATE INDEX package_entitlements_recorder_membership_fk_idx ON package_entitlements (company_id, recorded_by, recorded_by_membership_id);
--> statement-breakpoint
-- قراءة باقات العميل: ترتيب الانتهاء هو اللي بيحتاجه الاستعلام (FR-070).
CREATE INDEX package_entitlements_customer_read_idx ON package_entitlements (company_id, business_id, customer_id, expires_on);
--> statement-breakpoint
-- سطر الملف داخل الدفعة الواحدة فريد؛ والدفعة نفسها مش بتتكرر على الشركة.
CREATE UNIQUE INDEX package_entitlements_import_row_key ON package_entitlements (company_id, import_batch_id, import_row) WHERE import_batch_id IS NOT NULL;
--> statement-breakpoint
-- المكوّن: خدمة واحدة من الباقة، وقيمته = عدد الجلسات × قيمة الجلسة.
CREATE TABLE package_components (
  company_id uuid NOT NULL,
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  service_id uuid NOT NULL,
  position smallint NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  list_price_snapshot numeric(14,3) NOT NULL,
  sessions_total integer NOT NULL,
  component_value numeric(14,3) NOT NULL,
  -- عمود القفل: مش قيمة، صلاحية واحدة بس عشان SELECT … FOR UPDATE يقفل الصف. قيمته دايماً صفر.
  lock_touch smallint NOT NULL DEFAULT 0,
  CONSTRAINT package_components_pkey PRIMARY KEY (company_id, id),
  CONSTRAINT package_components_business_id_key UNIQUE (company_id, business_id, id),
  -- الخدمة نفسها مرة واحدة في الباقة، والموقع مرة واحدة، والمفتاح الرابع هو هدف المفتاح الأجنبي بتاع الجلسات.
  CONSTRAINT package_components_entitlement_service_key UNIQUE (company_id, entitlement_id, service_id),
  CONSTRAINT package_components_entitlement_position_key UNIQUE (company_id, entitlement_id, position),
  CONSTRAINT package_components_entitlement_id_key UNIQUE (company_id, business_id, entitlement_id, id),
  CONSTRAINT package_components_position_check CHECK (position BETWEEN 1 AND 20),
  CONSTRAINT package_components_sessions_total_check CHECK (sessions_total BETWEEN 1 AND 365),
  CONSTRAINT package_components_list_price_check CHECK (list_price_snapshot BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_components_value_check CHECK (component_value BETWEEN 0 AND 99999999999.999),
  CONSTRAINT package_components_lock_touch_check CHECK (lock_touch = 0)
);
--> statement-breakpoint
ALTER TABLE package_components ADD CONSTRAINT package_components_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies (id);
--> statement-breakpoint
ALTER TABLE package_components ADD CONSTRAINT package_components_entitlement_fk
  FOREIGN KEY (company_id, business_id, entitlement_id) REFERENCES package_entitlements (company_id, business_id, id);
--> statement-breakpoint
ALTER TABLE package_components ADD CONSTRAINT package_components_service_fk
  FOREIGN KEY (company_id, business_id, service_id) REFERENCES services (company_id, business_id, id);
--> statement-breakpoint
CREATE INDEX package_components_entitlement_fk_idx ON package_components (company_id, business_id, entitlement_id);
--> statement-breakpoint
CREATE INDEX package_components_service_fk_idx ON package_components (company_id, business_id, service_id);
--> statement-breakpoint
-- الجلسة: رصيد واحد قابل للاستهلاك، قيمتها جزء من قيمة المكوّن.
CREATE TABLE package_session_slots (
  company_id uuid NOT NULL,
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  component_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  unit_value numeric(14,3) NOT NULL,
  state text NOT NULL,
  -- معرّف الاسترداد: بيتكتب في هجرة 43-1؛ لحد ما كده حالة USED مش ممكنة.
  current_redemption_id uuid,
  CONSTRAINT package_session_slots_pkey PRIMARY KEY (company_id, id),
  CONSTRAINT package_session_slots_business_id_key UNIQUE (company_id, business_id, id),
  CONSTRAINT package_session_slots_component_ordinal_key UNIQUE (company_id, component_id, ordinal),
  CONSTRAINT package_session_slots_state_check CHECK (state IN ('FREE','USED','REFUNDED','IMPORTED_USED')),
  -- الجلسة المستخدَمة لازم يكون ليها استرداد حيّ، والجلسة اللي مش مستهدَمة مفيش لها استرداد (TD-5b).
  CONSTRAINT package_session_slots_state_redemption_check CHECK ((state = 'USED') = (current_redemption_id IS NOT NULL)),
  CONSTRAINT package_session_slots_unit_value_check CHECK (unit_value BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE package_session_slots ADD CONSTRAINT package_session_slots_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies (id);
--> statement-breakpoint
ALTER TABLE package_session_slots ADD CONSTRAINT package_session_slots_component_fk
  FOREIGN KEY (company_id, business_id, entitlement_id, component_id) REFERENCES package_components (company_id, business_id, entitlement_id, id);
--> statement-breakpoint
CREATE INDEX package_session_slots_component_fk_idx ON package_session_slots (company_id, business_id, entitlement_id, component_id);
--> statement-breakpoint
-- أول جلسة حرة في المكوّن: ده اللي بتدور عليه شاشة الاسترداد.
CREATE INDEX package_session_slots_free_idx ON package_session_slots (company_id, component_id, ordinal) WHERE state = 'FREE';
--> statement-breakpoint
-- العزل: شركة واحدة بس تشوف صفوفها، والكتابة مش بتعدّي حدود الشركة (CLAUDE.md §5).
ALTER TABLE package_entitlements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_entitlements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_entitlements_select ON package_entitlements FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_entitlements_insert ON package_entitlements FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_entitlements_update ON package_entitlements FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE package_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_components_select ON package_components FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_components_insert ON package_components FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_components_update ON package_components FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE package_session_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE package_session_slots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY package_session_slots_select ON package_session_slots FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_session_slots_insert ON package_session_slots FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY package_session_slots_update ON package_session_slots FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON package_entitlements, package_components, package_session_slots FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_entitlements, package_components, package_session_slots TO pospay_app;
--> statement-breakpoint
-- التحديث مسموح على الأرقام اللي هتتحرك في هجرات 45 و46-1 بس؛ التريغر نفسه مقفول لحد ما تفتح.
GRANT UPDATE (expires_on, refunded_amount, revision) ON package_entitlements TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (lock_touch) ON package_components TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (state, current_redemption_id) ON package_session_slots TO pospay_app;
--> statement-breakpoint
-- ختم الإنشاء: التريغر بيكتب الختم بنفسه وبيستبدل أي قيمة جاية من المستدعي، لأن القيمة الافتراضية وحدها بتتزوّر (ADR-0050).
CREATE FUNCTION package_entitlements_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  NEW.created_system_id := sid;
  NEW.created_txid := pg_current_xact_id();
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
-- التحديث مقفول بالكامل: التحركات الحقيقية بتفتحها هجرات 43-1 و45 و46-1 بنفس اسم الدالة وبنفس التوقيع.
CREATE FUNCTION package_entitlements_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  -- الختم ما بيتختمش تاني: بياخد من OLD عشان يفضل دليل معاملة الإنشاء (ADR-0050).
  NEW.created_system_id := OLD.created_system_id;
  NEW.created_txid := OLD.created_txid;
  IF NEW.expires_on IS DISTINCT FROM OLD.expires_on THEN
    RAISE EXCEPTION 'the expiry of an entitlement is closed until the extension row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_expires_on_closed';
  END IF;
  IF NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount THEN
    RAISE EXCEPTION 'the refunded amount of an entitlement is closed until the refund row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_refunded_amount_closed';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    RAISE EXCEPTION 'the revision of an entitlement is closed until the refund row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_revision_closed';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['expires_on','refunded_amount','revision','created_system_id','created_txid'])
     IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['expires_on','refunded_amount','revision','created_system_id','created_txid']) THEN
    RAISE EXCEPTION 'an entitlement changes only through its own transition'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlements_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- المكوّن ما بينفعش يتعدّل خالص: عمود القفل موجود بس عشان SELECT … FOR UPDATE يقدر يقفل الصف.
CREATE FUNCTION package_components_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'a package component is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'package_components_immutable';
END $$;
--> statement-breakpoint
-- الجلسة: التحركات مقفولة لحد ما 43-1 تفتح FREE ↔ USED و46-1 تفتح FREE → REFUNDED بنفس اسم الدالة.
CREATE FUNCTION package_session_slots_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'the state of a session is closed until the redemption row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_state_closed';
  END IF;
  IF NEW.current_redemption_id IS DISTINCT FROM OLD.current_redemption_id THEN
    RAISE EXCEPTION 'the redemption of a session is closed until the redemption row exists'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_redemption_closed';
  END IF;
  IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'a session changes only through its own transition'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- ختم التركيب: المكوّن لازم يكون لاستحقاق اتختم في نفس المعاملة، والاستحقاق ده ما يبقاش عنده جلسات بعد كده (TD-15 b).
CREATE FUNCTION package_components_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint; v_xid xid8;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  v_xid := pg_current_xact_id();
  -- NOT EXISTS مش EXISTS: الأب الناقص أو اللي مش باين لازم يترفض، مش يعدّي.
  IF EXISTS (
    SELECT 1 FROM new_components c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.package_entitlements e
      WHERE e.company_id = c.company_id
        AND e.business_id = c.business_id
        AND e.id = c.entitlement_id
        AND e.created_system_id = sid
        AND e.created_txid = v_xid
    )
  ) THEN
    RAISE EXCEPTION 'a component belongs to an entitlement of another transaction'
      USING ERRCODE = '23514', CONSTRAINT = 'package_components_creation_seal';
  END IF;
  -- التركيب بيتقفل: كل المكوّنات بتدخل قبل أول جلسة، فما ينفعش استحقاق ياخد مكوّن بعد ما بدأ ياخد جلسات.
  IF EXISTS (
    SELECT 1 FROM new_components c
    WHERE EXISTS (
      SELECT 1 FROM public.package_session_slots s
      WHERE s.company_id = c.company_id
        AND s.business_id = c.business_id
        AND s.entitlement_id = c.entitlement_id
    )
  ) THEN
    RAISE EXCEPTION 'the entitlement of this component already has sessions'
      USING ERRCODE = '23514', CONSTRAINT = 'package_components_closed_composition';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- ختم التركيب للجلسات: نفس ختم الاستحقاق، زائد الشكل الأولي للجلسة والرقم بتاع المكوّن (TD-15 b).
CREATE FUNCTION package_session_slots_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint; v_xid xid8;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  v_xid := pg_current_xact_id();
  IF EXISTS (
    SELECT 1 FROM new_slots s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.package_entitlements e
      WHERE e.company_id = s.company_id
        AND e.business_id = s.business_id
        AND e.id = s.entitlement_id
        AND e.created_system_id = sid
        AND e.created_txid = v_xid
    )
  ) THEN
    RAISE EXCEPTION 'a session belongs to an entitlement of another transaction'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_creation_seal';
  END IF;
  -- البيع بيبني جلسات حرة، والاستيراد بيبني حرة ومستعملة بالترتيب (FR-063).
  IF EXISTS (
    SELECT 1 FROM new_slots s
    JOIN public.package_entitlements e
      ON e.company_id = s.company_id AND e.business_id = s.business_id AND e.id = s.entitlement_id
    WHERE (e.provenance = 'SOLD' AND s.state <> 'FREE')
       OR (e.provenance = 'IMPORTED' AND s.state NOT IN ('FREE','IMPORTED_USED'))
  ) THEN
    RAISE EXCEPTION 'the initial state of a session does not fit the source of the entitlement'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_initial_state';
  END IF;
  -- الرقم لازم يكون جوه عدد جلسات المكوّن؛ بعد ما التركيب يتقفل مفيش رقم تاني (TD-15 b).
  IF EXISTS (
    SELECT 1 FROM new_slots s
    JOIN public.package_components c
      ON c.company_id = s.company_id AND c.business_id = s.business_id
      AND c.entitlement_id = s.entitlement_id AND c.id = s.component_id
    WHERE s.ordinal < 1 OR s.ordinal > c.sessions_total
  ) THEN
    RAISE EXCEPTION 'the ordinal of a session is outside the sessions of its component'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_ordinal_range';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- حفظ القيمة (BR-01): مجموع قيم الجلسات = قيمة المكوّن، ومجموع قيم المكوّنات = السعر المدفوع، بالميّ للميّ.
-- الفحص مؤجل لحد ما المعاملة تخلص، عشان ترتيب الكتابة في حالة الاستخدام ما يبقش غلط (spec 058 §6).
CREATE FUNCTION package_entitlement_value_conservation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
  v_business uuid;
  v_entitlement uuid;
  v_price_paid numeric(14,3);
  v_provenance text;
  v_component_count integer;
  v_broken integer;
  v_total numeric(14,3);
BEGIN
  SELECT e.company_id, e.business_id, e.id, e.price_paid, e.provenance
  INTO v_company, v_business, v_entitlement, v_price_paid, v_provenance
  FROM public.package_entitlements e
  WHERE e.company_id = NEW.company_id AND e.id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the entitlement of this transaction is gone'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  SELECT count(*) INTO v_component_count
  FROM public.package_components c
  WHERE c.company_id = v_company AND c.business_id = v_business AND c.entitlement_id = v_entitlement;
  IF v_component_count < 1 THEN
    RAISE EXCEPTION 'an entitlement needs at least one component'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  -- التجميع على مستوى المكوّن الأول: مجموع قيمة المكوّن بيتحسب من جلساته هو، مش من ربط الجلسات على المكوّنات.
  SELECT count(*) INTO v_broken
  FROM (
    SELECT c.id
    FROM public.package_components c
    LEFT JOIN public.package_session_slots s
      ON s.company_id = c.company_id
      AND s.business_id = c.business_id
      AND s.entitlement_id = c.entitlement_id
      AND s.component_id = c.id
    WHERE c.company_id = v_company AND c.business_id = v_business AND c.entitlement_id = v_entitlement
    GROUP BY c.id, c.sessions_total, c.component_value
    HAVING count(s.id) <> c.sessions_total
       OR count(DISTINCT s.ordinal) <> c.sessions_total
       OR min(s.ordinal) IS DISTINCT FROM 1
       OR max(s.ordinal) IS DISTINCT FROM c.sessions_total
       OR coalesce(sum(s.unit_value), 0) IS DISTINCT FROM c.component_value
  ) AS broken_components;
  IF v_broken > 0 THEN
    RAISE EXCEPTION 'the sessions of a component do not match its value'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  -- الجلسات المستعملة في الاستيراد بالترتيب 1..k بالظبط، وk = عددها؛ والبيع مفيش فيه جلسة مستعملة.
  SELECT count(*) INTO v_broken
  FROM (
    SELECT c.id
    FROM public.package_components c
    JOIN public.package_session_slots s
      ON s.company_id = c.company_id
      AND s.business_id = c.business_id
      AND s.entitlement_id = c.entitlement_id
      AND s.component_id = c.id
    WHERE c.company_id = v_company AND c.business_id = v_business AND c.entitlement_id = v_entitlement
      AND s.state = 'IMPORTED_USED'
    GROUP BY c.id
    HAVING count(s.id) <> count(DISTINCT s.ordinal)
       OR min(s.ordinal) IS DISTINCT FROM 1
       OR max(s.ordinal) IS DISTINCT FROM count(s.id)
  ) AS broken_imported;
  IF v_broken > 0 THEN
    RAISE EXCEPTION 'the imported used sessions of a component are not the first k ordinals'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  IF v_provenance = 'SOLD' AND EXISTS (
    SELECT 1 FROM public.package_session_slots s
    WHERE s.company_id = v_company AND s.business_id = v_business
      AND s.entitlement_id = v_entitlement AND s.state = 'IMPORTED_USED'
  ) THEN
    RAISE EXCEPTION 'a sold entitlement has no imported session'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  SELECT coalesce(sum(c.component_value), 0) INTO v_total
  FROM public.package_components c
  WHERE c.company_id = v_company AND c.business_id = v_business AND c.entitlement_id = v_entitlement;
  IF v_total IS DISTINCT FROM v_price_paid THEN
    RAISE EXCEPTION 'the components do not sum to the price paid'
      USING ERRCODE = '23514', CONSTRAINT = 'package_entitlement_value_conservation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION package_entitlements_insert_guard(), package_entitlements_update_guard(),
  package_components_insert_guard(), package_components_update_guard(),
  package_session_slots_insert_guard(), package_session_slots_update_guard(),
  package_entitlement_value_conservation() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION package_entitlements_insert_guard(), package_entitlements_update_guard(),
  package_components_insert_guard(), package_components_update_guard(),
  package_session_slots_insert_guard(), package_session_slots_update_guard(),
  package_entitlement_value_conservation() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER package_entitlements_insert_guard BEFORE INSERT ON package_entitlements
FOR EACH ROW EXECUTE FUNCTION package_entitlements_insert_guard();
--> statement-breakpoint
CREATE TRIGGER package_entitlements_update_guard BEFORE UPDATE ON package_entitlements
FOR EACH ROW EXECUTE FUNCTION package_entitlements_update_guard();
--> statement-breakpoint
CREATE TRIGGER package_components_update_guard BEFORE UPDATE ON package_components
FOR EACH ROW EXECUTE FUNCTION package_components_update_guard();
--> statement-breakpoint
CREATE TRIGGER package_components_insert_guard AFTER INSERT ON package_components
REFERENCING NEW TABLE AS new_components FOR EACH STATEMENT EXECUTE FUNCTION package_components_insert_guard();
--> statement-breakpoint
CREATE TRIGGER package_session_slots_update_guard BEFORE UPDATE ON package_session_slots
FOR EACH ROW EXECUTE FUNCTION package_session_slots_update_guard();
--> statement-breakpoint
CREATE TRIGGER package_session_slots_insert_guard AFTER INSERT ON package_session_slots
REFERENCING NEW TABLE AS new_slots FOR EACH STATEMENT EXECUTE FUNCTION package_session_slots_insert_guard();
--> statement-breakpoint
-- الفحص المؤجل: بيتفحص مرة واحدة لكل استحقاق عند الالتزام، فترتيب الكتابة في حالة الاستخدام ما يبقش غلط.
CREATE CONSTRAINT TRIGGER package_entitlement_value_conservation
AFTER INSERT ON package_entitlements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION package_entitlement_value_conservation();
