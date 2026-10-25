CREATE TABLE "commission_statement_attachments" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"attached_from" date NOT NULL,
	"attached_to" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_attachments_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_attachments_link_key" UNIQUE("company_id","statement_id","employee_id","branch_id","attached_from"),
	CONSTRAINT "commission_statement_attachments_range" CHECK ("commission_statement_attachments"."attached_from" <= "commission_statement_attachments"."attached_to")
);
--> statement-breakpoint
CREATE TABLE "commission_statement_lines" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_number" integer NOT NULL,
	"employee_name_ar" text,
	"employee_name_en" text NOT NULL,
	"source_ref" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"previous_amount" numeric(14, 3),
	"new_amount" numeric(14, 3),
	"source_period" char(7),
	"source_branch_id" uuid,
	"source_business_date" date,
	"attached_branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"line_id" uuid,
	"session_id" uuid,
	"service_id" uuid,
	"service_name_ar" text,
	"service_name_en" text,
	"customer_id" uuid,
	"customer_name" text,
	"business_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_lines_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_lines_source_key" UNIQUE("company_id","statement_id","employee_id","source_ref"),
	CONSTRAINT "commission_statement_lines_kind" CHECK ("commission_statement_lines"."kind" IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH','CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH','CARRY_COMMISSION','CARRY_TIP_CARD','EMPLOYEE')),
	CONSTRAINT "commission_statement_lines_amounts" CHECK ("commission_statement_lines"."amount" <> 'NaN'::numeric
        AND ("commission_statement_lines"."previous_amount" IS NULL OR "commission_statement_lines"."previous_amount" <> 'NaN'::numeric)
        AND ("commission_statement_lines"."new_amount" IS NULL OR "commission_statement_lines"."new_amount" <> 'NaN'::numeric)),
	CONSTRAINT "commission_statement_lines_correction_amounts" CHECK (("commission_statement_lines"."kind" IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH')
          AND "commission_statement_lines"."previous_amount" IS NOT NULL AND "commission_statement_lines"."new_amount" IS NOT NULL
          AND "commission_statement_lines"."amount" = "commission_statement_lines"."new_amount" - "commission_statement_lines"."previous_amount")
        OR ("commission_statement_lines"."kind" NOT IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH')
          AND "commission_statement_lines"."previous_amount" IS NULL AND "commission_statement_lines"."new_amount" IS NULL)),
	CONSTRAINT "commission_statement_lines_source_fields" CHECK (("commission_statement_lines"."source_branch_id" IS NULL) = ("commission_statement_lines"."kind" IN ('EMPLOYEE','CARRY_COMMISSION','CARRY_TIP_CARD'))
        AND ("commission_statement_lines"."source_business_date" IS NULL) = ("commission_statement_lines"."kind" IN ('EMPLOYEE','CARRY_COMMISSION','CARRY_TIP_CARD'))),
	CONSTRAINT "commission_statement_lines_carry_branches" CHECK ("commission_statement_lines"."kind" NOT IN ('CARRY_COMMISSION','CARRY_TIP_CARD') OR cardinality("commission_statement_lines"."attached_branch_ids") = 0),
	CONSTRAINT "commission_statement_lines_employee_amount" CHECK ("commission_statement_lines"."kind" <> 'EMPLOYEE' OR "commission_statement_lines"."amount" = 0),
	CONSTRAINT "commission_statement_lines_detail" CHECK ("commission_statement_lines"."kind" IN ('COMMISSION','CORRECTION') OR
        ("commission_statement_lines"."line_id" IS NULL AND "commission_statement_lines"."session_id" IS NULL AND "commission_statement_lines"."service_id" IS NULL
          AND "commission_statement_lines"."service_name_ar" IS NULL AND "commission_statement_lines"."service_name_en" IS NULL
          AND "commission_statement_lines"."customer_id" IS NULL AND "commission_statement_lines"."customer_name" IS NULL AND "commission_statement_lines"."business_date" IS NULL)),
	CONSTRAINT "commission_statement_lines_commission_detail" CHECK ("commission_statement_lines"."kind" <> 'COMMISSION' OR
        ("commission_statement_lines"."line_id" IS NOT NULL AND "commission_statement_lines"."session_id" IS NOT NULL
          AND "commission_statement_lines"."service_id" IS NOT NULL AND "commission_statement_lines"."business_date" IS NOT NULL)),
	CONSTRAINT "commission_statement_lines_source_period" CHECK (("commission_statement_lines"."source_period" IS NOT NULL) = ("commission_statement_lines"."kind" IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH','CARRY_COMMISSION','CARRY_TIP_CARD'))
        AND ("commission_statement_lines"."source_period" IS NULL OR "commission_statement_lines"."source_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_statement_lines"."source_period", 1, 4) <> '0000'))
);
--> statement-breakpoint
CREATE TABLE "commission_statements" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"current_fingerprint" char(64),
	"reviewed_fingerprint" char(64),
	"reviewed_statement_fingerprint" char(64),
	"input_fingerprint" char(64),
	"statement_fingerprint" char(64),
	"reviewed_by" uuid,
	"reviewed_membership_id" uuid,
	"reviewed_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_xact_id" "xid8",
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statements_period_key" UNIQUE("company_id","business_id","period"),
	CONSTRAINT "commission_statements_period_id_key" UNIQUE("company_id","business_id","period","id"),
	CONSTRAINT "commission_statements_company_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "commission_statements_period" CHECK ("commission_statements"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND substr("commission_statements"."period", 1, 4) <> '0000'),
	CONSTRAINT "commission_statements_status" CHECK ("commission_statements"."status" IN ('DRAFT','REVIEWED','APPROVED','PAID')),
	CONSTRAINT "commission_statements_fingerprints" CHECK (("commission_statements"."current_fingerprint" IS NULL OR "commission_statements"."current_fingerprint" ~ '^[0-9a-f]{64}$')
        AND ("commission_statements"."reviewed_fingerprint" IS NULL OR "commission_statements"."reviewed_fingerprint" ~ '^[0-9a-f]{64}$')
        AND ("commission_statements"."reviewed_statement_fingerprint" IS NULL OR "commission_statements"."reviewed_statement_fingerprint" ~ '^[0-9a-f]{64}$')
        AND ("commission_statements"."input_fingerprint" IS NULL OR "commission_statements"."input_fingerprint" ~ '^[0-9a-f]{64}$')
        AND ("commission_statements"."statement_fingerprint" IS NULL OR "commission_statements"."statement_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "commission_statements_revision" CHECK ("commission_statements"."revision" >= 0),
	CONSTRAINT "commission_statements_stage" CHECK (("commission_statements"."status" = 'DRAFT' AND "commission_statements"."reviewed_fingerprint" IS NULL
          AND "commission_statements"."reviewed_statement_fingerprint" IS NULL AND "commission_statements"."reviewed_by" IS NULL
          AND "commission_statements"."reviewed_membership_id" IS NULL AND "commission_statements"."reviewed_at" IS NULL
          AND "commission_statements"."input_fingerprint" IS NULL AND "commission_statements"."statement_fingerprint" IS NULL
          AND "commission_statements"."approved_by" IS NULL AND "commission_statements"."approved_at" IS NULL AND "commission_statements"."approval_xact_id" IS NULL)
        OR ("commission_statements"."status" = 'REVIEWED' AND "commission_statements"."reviewed_fingerprint" IS NOT NULL
          AND "commission_statements"."reviewed_statement_fingerprint" IS NOT NULL AND "commission_statements"."reviewed_by" IS NOT NULL
          AND "commission_statements"."reviewed_membership_id" IS NOT NULL AND "commission_statements"."reviewed_at" IS NOT NULL
          AND "commission_statements"."input_fingerprint" IS NULL AND "commission_statements"."statement_fingerprint" IS NULL
          AND "commission_statements"."approved_by" IS NULL AND "commission_statements"."approved_at" IS NULL AND "commission_statements"."approval_xact_id" IS NULL)
        OR ("commission_statements"."status" IN ('APPROVED','PAID') AND "commission_statements"."reviewed_fingerprint" IS NOT NULL
          AND "commission_statements"."reviewed_statement_fingerprint" IS NOT NULL AND "commission_statements"."reviewed_by" IS NOT NULL
          AND "commission_statements"."reviewed_membership_id" IS NOT NULL AND "commission_statements"."reviewed_at" IS NOT NULL
          AND "commission_statements"."input_fingerprint" IS NOT NULL AND "commission_statements"."statement_fingerprint" IS NOT NULL
          AND "commission_statements"."approved_by" IS NOT NULL AND "commission_statements"."approved_at" IS NOT NULL AND "commission_statements"."approval_xact_id" IS NOT NULL
          AND "commission_statements"."statement_fingerprint" = "commission_statements"."reviewed_statement_fingerprint")),
	CONSTRAINT "commission_statements_input_matches_review" CHECK ("commission_statements"."status" NOT IN ('APPROVED','PAID') OR "commission_statements"."input_fingerprint" = "commission_statements"."reviewed_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "commission_statement_attachments" ADD CONSTRAINT "commission_statement_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_attachments" ADD CONSTRAINT "commission_statement_attachments_statement_fk" FOREIGN KEY ("company_id","business_id","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_attachments" ADD CONSTRAINT "commission_statement_attachments_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_attachments" ADD CONSTRAINT "commission_statement_attachments_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_statement_fk" FOREIGN KEY ("company_id","business_id","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_source_branch_fk" FOREIGN KEY ("company_id","business_id","source_branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_reviewed_membership_fk" FOREIGN KEY ("company_id","reviewed_by","reviewed_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statement_attachments_statement_idx" ON "commission_statement_attachments" USING btree ("company_id","business_id","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_attachments_statement_employee_idx" ON "commission_statement_attachments" USING btree ("company_id","statement_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_statement_attachments_employee_idx" ON "commission_statement_attachments" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_statement_attachments_branch_idx" ON "commission_statement_attachments" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_statement_idx" ON "commission_statement_lines" USING btree ("company_id","business_id","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_statement_employee_idx" ON "commission_statement_lines" USING btree ("company_id","statement_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_employee_idx" ON "commission_statement_lines" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_source_branch_idx" ON "commission_statement_lines" USING btree ("company_id","business_id","source_branch_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_attached_branches_idx" ON "commission_statement_lines" USING gin ("attached_branch_ids");--> statement-breakpoint
CREATE INDEX "commission_statements_reviewed_by_idx" ON "commission_statements" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "commission_statements_approved_by_idx" ON "commission_statements" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "commission_statements_reviewed_membership_idx" ON "commission_statements" USING btree ("company_id","reviewed_by","reviewed_membership_id");
--> statement-breakpoint
-- عزل المستأجر: كل جدول من الثلاثة بيقفل على company_id بتاع الجلسة، والـ FORCE بيمنع أي مسار يتجاوز السياسة.
ALTER TABLE commission_statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statements_select ON commission_statements FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statements_insert ON commission_statements FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statements_update ON commission_statements FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE commission_statement_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statement_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_lines_select ON commission_statement_lines FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_lines_insert ON commission_statement_lines FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE commission_statement_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statement_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_attachments_select ON commission_statement_attachments FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_attachments_insert ON commission_statement_attachments FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- الجداول الثلاثة مالية: مفيش حذف، والجدولين المجمّدين للإدخال فقط؛ والمنح دي حد التطبيق كله.
REVOKE ALL ON commission_statements, commission_statement_lines, commission_statement_attachments FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_statements, commission_statement_lines, commission_statement_attachments TO pospay_app;
--> statement-breakpoint
-- هوية الشهر (company_id وid وbusiness_id وperiod وcreated_at) ودليل الاعتماد (approval_xact_id) ما بيتكتبوش بالمنح؛
-- المنح والتريغر مع بعضهم بيثبّتوا دول، واللي بيتحدّث هو حالة الكشف وبصماتها فقط. أعمدة الدفع بتيجي مع 54-1.
GRANT UPDATE (status, current_fingerprint, reviewed_fingerprint, reviewed_statement_fingerprint, reviewed_by,
  reviewed_membership_id, reviewed_at, input_fingerprint, statement_fingerprint, approved_by, approved_at, revision)
  ON commission_statements TO pospay_app;
--> statement-breakpoint
-- الكشف بيتنشأ DRAFT بس (FR-001): الاعتماد له مساره هو، فما ينفع أي مسار يدخّل كشفاً معتمداً ويتخطّى المراجعة.
CREATE FUNCTION commission_statements_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'a commission statement is created DRAFT' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_insert_draft';
  END IF;
  -- دليل الاعتماد ما بيجيش من المتصل؛ معاملة الاعتماد نفسها هي اللي بتكتبه.
  NEW.approval_xact_id := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statements_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statements_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statements_insert_guard BEFORE INSERT ON commission_statements
FOR EACH ROW EXECUTE FUNCTION commission_statements_insert_guard();
--> statement-breakpoint
-- التحديث: هوية الصف ما بتتغيّرش، والشهر المدفوع ما بيتغيّرش أبداً، والشهر المعتمد ما بينتقلش غير لـ PAID (FR-001).
CREATE FUNCTION commission_statements_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.period IS DISTINCT FROM OLD.period
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the identity of a commission statement is immutable' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_identity_immutable';
  END IF;
  IF OLD.status = 'PAID' THEN
    RAISE EXCEPTION 'a paid commission statement never changes' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_paid_immutable';
  END IF;
  IF OLD.status = 'APPROVED' THEN
    IF NEW.status IS DISTINCT FROM 'PAID' THEN
      RAISE EXCEPTION 'an approved commission statement moves only to paid' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_approved_frozen';
    END IF;
    -- الدفع بغيّر الحالة بس؛ أي عمود تاني (ومنه دليل الاعتماد) يبقى زي ما كان.
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'paying a commission statement changes only its status' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_payment_only';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'REVIEWED') THEN
    RAISE EXCEPTION 'a draft commission statement moves only to reviewed' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_transition';
  END IF;
  IF OLD.status = 'REVIEWED' AND NEW.status NOT IN ('REVIEWED', 'DRAFT', 'APPROVED') THEN
    RAISE EXCEPTION 'a reviewed commission statement moves only to draft or approved' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_transition';
  END IF;
  -- دليل الاعتماد هو معرّف المعاملة التي اعتمدته هو، مش أي معاملة تانية.
  IF OLD.status = 'REVIEWED' AND NEW.status = 'APPROVED' THEN
    -- الدليل المجمّد للمراجعة (مين راجع وإيه شاف) ما يتعادش كتابته في تحديث الاعتماد.
    IF NEW.reviewed_fingerprint IS DISTINCT FROM OLD.reviewed_fingerprint
       OR NEW.reviewed_statement_fingerprint IS DISTINCT FROM OLD.reviewed_statement_fingerprint
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_membership_id IS DISTINCT FROM OLD.reviewed_membership_id
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'approving a commission statement keeps the review evidence' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_review_evidence';
    END IF;
    NEW.approval_xact_id := pg_current_xact_id();
  ELSE
    NEW.approval_xact_id := OLD.approval_xact_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statements_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statements_update_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statements_update_guard BEFORE UPDATE ON commission_statements
FOR EACH ROW EXECUTE FUNCTION commission_statements_update_guard();
--> statement-breakpoint
-- الصفوف المجمّدة بتتكتب مرة واحدة في معاملة الاعتماد نفسها: FR-001 بيمنع أي تغيير في شهر معتمد غير الانتقال
-- لـ PAID، وبذرة FR-044 بتعمل نفس المشي، فما ينفع معاملة تانية تجمّد صفوفاً في شهر معتمد. والـ savepoint ما
-- بيغيّرش الدليل لأن pg_current_xact_id() هو معرّف المعاملة الأساسية.
CREATE FUNCTION commission_statement_frozen_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  statement_status text;
  statement_proof xid8;
  statement_period char(7);
BEGIN
  SELECT s.status, s.approval_xact_id, s.period
    INTO statement_status, statement_proof, statement_period
    FROM public.commission_statements s
   WHERE s.company_id = NEW.company_id AND s.id = NEW.statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the statement of a frozen row does not exist' USING ERRCODE = '23503', CONSTRAINT = TG_TABLE_NAME || '_statement_fk';
  END IF;
  IF statement_status IS DISTINCT FROM 'APPROVED' OR statement_proof IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'a statement is frozen only by the transaction that approved it' USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_frozen_by_approval';
  END IF;
  -- شهر المصدر لازم يكون قبل شهر الكشف: التصحيح أو الـ carry بينزل في شهر بعد مصدره (D-13 و D-22).
  IF TG_TABLE_NAME = 'commission_statement_lines' THEN
    IF NEW.source_period IS NOT NULL AND NEW.source_period::text >= statement_period::text THEN
      RAISE EXCEPTION 'the source month of a correction or carry precedes the statement month' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_lines_source_before_statement';
    END IF;
  END IF;
  -- لقطة الارتباط مقصوصة على شهر الكشف (FR-033)، فمداها لازم يبقى جوه الشهر؛
  -- الفحص جوه شرط مستقل لأن عمود المدة مش موجود أصلاً في جدول السطور.
  IF TG_TABLE_NAME = 'commission_statement_attachments' THEN
    IF NEW.attached_from < to_date(statement_period || '-01', 'YYYY-MM-DD')
       OR NEW.attached_to >= (to_date(statement_period || '-01', 'YYYY-MM-DD') + interval '1 month')::date THEN
      RAISE EXCEPTION 'a frozen attachment lies inside the month of its statement' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_attachments_in_month';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statement_frozen_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statement_frozen_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statement_lines_frozen_insert_guard BEFORE INSERT ON commission_statement_lines
FOR EACH ROW EXECUTE FUNCTION commission_statement_frozen_insert_guard();
--> statement-breakpoint
CREATE TRIGGER commission_statement_attachments_frozen_insert_guard BEFORE INSERT ON commission_statement_attachments
FOR EACH ROW EXECUTE FUNCTION commission_statement_frozen_insert_guard();