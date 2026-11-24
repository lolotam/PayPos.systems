CREATE TABLE "commission_statement_payments" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"exact_payable" numeric(14, 3) NOT NULL,
	"paid_amount" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_payments_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "commission_statement_payments_employee_key" UNIQUE("company_id","statement_id","employee_id"),
	CONSTRAINT "commission_statement_payments_amounts" CHECK ("commission_statement_payments"."exact_payable" >= 0 AND "commission_statement_payments"."paid_amount" >= 0
        AND "commission_statement_payments"."exact_payable" <> 'NaN'::numeric AND "commission_statement_payments"."paid_amount" <> 'NaN'::numeric)
);
--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "paid_method" text;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "paid_note" text;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "payment_xact_id" "xid8";--> statement-breakpoint
ALTER TABLE "commission_statement_payments" ADD CONSTRAINT "commission_statement_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_payments" ADD CONSTRAINT "commission_statement_payments_statement_fk" FOREIGN KEY ("company_id","business_id","statement_id") REFERENCES "public"."commission_statements"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_payments" ADD CONSTRAINT "commission_statement_payments_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statement_payments_statement_idx" ON "commission_statement_payments" USING btree ("company_id","business_id","statement_id");--> statement-breakpoint
CREATE INDEX "commission_statement_payments_employee_idx" ON "commission_statement_payments" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_statements_paid_by_idx" ON "commission_statements" USING btree ("paid_by");--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_paid_method" CHECK ("commission_statements"."paid_method" IS NULL OR "commission_statements"."paid_method" IN ('WITH_SALARY','BANK_TRANSFER','CASH'));--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_paid_note_length" CHECK ("commission_statements"."paid_note" IS NULL OR char_length("commission_statements"."paid_note") <= 500);--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_payment_stage" CHECK (("commission_statements"."status" = 'PAID' AND "commission_statements"."paid_by" IS NOT NULL AND "commission_statements"."paid_at" IS NOT NULL
          AND "commission_statements"."paid_on" IS NOT NULL AND "commission_statements"."paid_method" IS NOT NULL AND "commission_statements"."payment_xact_id" IS NOT NULL)
        OR ("commission_statements"."status" <> 'PAID' AND "commission_statements"."paid_by" IS NULL AND "commission_statements"."paid_at" IS NULL
          AND "commission_statements"."paid_on" IS NULL AND "commission_statements"."paid_method" IS NULL AND "commission_statements"."paid_note" IS NULL
          AND "commission_statements"."payment_xact_id" IS NULL));--> statement-breakpoint
-- عزل المستأجر لجدول الصرف: نفس سياسة جداول الكشف، والـ FORCE بيمنع أي مسار يتجاوز السياسة.
ALTER TABLE commission_statement_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commission_statement_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY commission_statement_payments_select ON commission_statement_payments FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY commission_statement_payments_insert ON commission_statement_payments FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- جدول مالي إدخال بس: مفيش تعديل ولا حذف لأي دور، والمنح دي حد التطبيق كله.
REVOKE ALL ON commission_statement_payments FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON commission_statement_payments TO pospay_app;
--> statement-breakpoint
-- توسيع منح أعمدة الكشف بأعمدة الصرف الخمسة؛ دليل الدفع (payment_xact_id) بيكتبه التريغر وحده
-- زي دليل الاعتماد، فمش في المنح، والتحديث بره الانتقال APPROVED → PAID بيرفضه التريغر.
GRANT UPDATE (paid_by, paid_at, paid_on, paid_method, paid_note) ON commission_statements TO pospay_app;
--> statement-breakpoint
-- حارس تحديث الكشف الموسّع: نفس قواعد 0183، والدفع بغيّر الحالة وأعمدة الصرف بس،
-- ودليل الدفع هو معرّف معاملة الدفع نفسها لأن صفوف الدفع بتتقبل فيها بس.
CREATE OR REPLACE FUNCTION commission_statements_update_guard() RETURNS trigger
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
    -- الدفع بيغيّر الحالة وأعمدة الصرف بس؛ أي عمود تاني (ومنه دليل الاعتماد) يبقى زي ما كان.
    IF (to_jsonb(NEW) - 'status' - 'paid_by' - 'paid_at' - 'paid_on' - 'paid_method' - 'paid_note' - 'payment_xact_id')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paid_by' - 'paid_at' - 'paid_on' - 'paid_method' - 'paid_note' - 'payment_xact_id') THEN
      RAISE EXCEPTION 'paying a commission statement changes only its status and payment columns' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_payment_only';
    END IF;
    -- دليل الدفع هو معرّف المعاملة اللي دفعت، مش أي معاملة تانية؛ صفوف الدفع بتتقبل في المعاملة دي بس.
    NEW.payment_xact_id := pg_current_xact_id();
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'REVIEWED') THEN
    RAISE EXCEPTION 'a draft commission statement moves only to reviewed' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_transition';
  END IF;
  IF OLD.status = 'REVIEWED' AND NEW.status NOT IN ('REVIEWED', 'DRAFT', 'APPROVED') THEN
    RAISE EXCEPTION 'a reviewed commission statement moves only to draft or approved' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_transition';
  END IF;
  IF OLD.status = 'REVIEWED' AND NEW.status = 'APPROVED' THEN
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
  -- دليل الدفع ما بيتكتبش من أي مسار غير انتقال APPROVED → PAID.
  NEW.payment_xact_id := OLD.payment_xact_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statements_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statements_update_guard() TO pospay_app;
--> statement-breakpoint
-- حارس إدراج صف صرف: بيتقبل في معاملة الدفع نفسها بس (دليل payment_xact_id، زي ما التجميد بيعمل
-- مع approval_xact_id)، ولموظفة عندها صف EMPLOYEE مجمّد في نفس الكشف، والمبلغ متسق مع الطريقة:
-- كاش = الدقيق متقرّب لأقرب 5 فلوس (الفرق الأقصى 0.002 لأن أي مبلغ بالفلوس صحيح)، وغير كاش = الدقيق.
CREATE FUNCTION commission_statement_payments_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  statement_status text;
  statement_proof xid8;
  statement_method text;
BEGIN
  SELECT s.status, s.payment_xact_id, s.paid_method INTO statement_status, statement_proof, statement_method
    FROM public.commission_statements s
   WHERE s.company_id = NEW.company_id AND s.business_id = NEW.business_id AND s.id = NEW.statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the statement of a payment row does not exist' USING ERRCODE = '23503', CONSTRAINT = 'commission_statement_payments_statement_fk';
  END IF;
  IF statement_status IS DISTINCT FROM 'PAID' OR statement_proof IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'payment rows are written only by the transaction that marked the statement paid' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_payments_paid_by_transition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commission_statement_lines l
      WHERE l.company_id = NEW.company_id AND l.statement_id = NEW.statement_id
        AND l.employee_id = NEW.employee_id AND l.kind = 'EMPLOYEE') THEN
    RAISE EXCEPTION 'a payment row belongs to an employee frozen in the same statement' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_payments_employee_frozen';
  END IF;
  IF statement_method = 'CASH' THEN
    IF (NEW.paid_amount * 1000) % 5 <> 0 OR abs(NEW.paid_amount - NEW.exact_payable) > 0.002 THEN
      RAISE EXCEPTION 'a cash payment is the exact payable rounded to the nearest 5 fils' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_payments_cash_rounding';
    END IF;
  ELSIF NEW.paid_amount IS DISTINCT FROM NEW.exact_payable THEN
    RAISE EXCEPTION 'a non-cash payment equals the exact payable' USING ERRCODE = '23514', CONSTRAINT = 'commission_statement_payments_exact_amount';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statement_payments_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statement_payments_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER commission_statement_payments_insert_guard BEFORE INSERT ON commission_statement_payments
FOR EACH ROW EXECUTE FUNCTION commission_statement_payments_insert_guard();
--> statement-breakpoint
-- اكتمال الصرف بيتفحص عند الـ commit: الحالة بتتحدّث قبل الصفوف لأن حارس الإدراج محتاج دليل PAID،
-- فمجموعة موظفات الدفع لازم تساوي بالظبط موظفات صفوف EMPLOYEE المجمّدة؛ والفشل بيرجّع المعاملة كلها
-- فالكشف يفضل APPROVED بلا أعمدة صرف وبلا أي صف دفع.
CREATE FUNCTION commission_statements_payment_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
      SELECT 1 FROM public.commission_statement_lines l
       WHERE l.company_id = NEW.company_id AND l.statement_id = NEW.id AND l.kind = 'EMPLOYEE'
         AND NOT EXISTS (SELECT 1 FROM public.commission_statement_payments p
           WHERE p.company_id = l.company_id AND p.statement_id = l.statement_id AND p.employee_id = l.employee_id))
     OR EXISTS (
      SELECT 1 FROM public.commission_statement_payments p
       WHERE p.company_id = NEW.company_id AND p.statement_id = NEW.id
         AND NOT EXISTS (SELECT 1 FROM public.commission_statement_lines l
           WHERE l.company_id = p.company_id AND l.statement_id = p.statement_id
             AND l.employee_id = p.employee_id AND l.kind = 'EMPLOYEE')) THEN
    RAISE EXCEPTION 'marking a statement paid needs exactly one payment row per frozen employee' USING ERRCODE = '23514', CONSTRAINT = 'commission_statements_payment_complete';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commission_statements_payment_complete() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION commission_statements_payment_complete() TO pospay_app;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commission_statements_payment_complete AFTER UPDATE ON commission_statements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID')
EXECUTE FUNCTION commission_statements_payment_complete();
--> statement-breakpoint
-- قرار المالك CS-Q4 (2026-10-22): صلاحية الصرف للمالك والمدير العام والمحاسب افتراضياً، وقابلة للمنح
-- لأي دور بشري؛ والأدوار النظامية global فالإدخال يغطي كل الشركات القائمة بلا خطوة بيانات، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('pay:commissions:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'pay:commissions:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'accountant')
ON CONFLICT DO NOTHING;
