-- ربط قيود D-21 بياخد قفل على الجداول الثلاثة؛ المهلة القصيرة تخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا الحركة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- لو بناء الهجرة السابقة اتقطع ممكن يسيب فهرس INVALID (زي #293)؛ ربط قيد أو مفتاح بفهرس مش صالح ممنوع، فبنرفض برسالة واضحة.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.service_lines_id_session_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.service_sessions_branch_id_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.dp_consumed_line_binding_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.dp_session_branch_fk_idx') AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'discount proposal binding index from the previous migration is missing or INVALID; drop it and rerun the migration (ADR-0033)';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE service_lines ADD CONSTRAINT service_lines_id_session_key UNIQUE USING INDEX service_lines_id_session_key;
--> statement-breakpoint
ALTER TABLE service_sessions ADD CONSTRAINT service_sessions_branch_id_key UNIQUE USING INDEX service_sessions_branch_id_key;
--> statement-breakpoint
ALTER TABLE discount_proposals ADD CONSTRAINT dp_consumed_line_binding_key UNIQUE USING INDEX dp_consumed_line_binding_key;
--> statement-breakpoint
-- البند يستهلك موافقة من نشاطه وخدمته بس؛ الفحص يتأجل لحد الـ commit، والقيمة الفارغة بتتخطّى (MATCH SIMPLE).
-- البحث بيتخدم بالفهرس الجزئي service_lines_discount_proposal_uq (company_id, discount_proposal_id) اللي بيضيّق البحث على صف واحد، فمفيش فهرس تاني لازم.
ALTER TABLE service_lines ADD CONSTRAINT service_lines_discount_proposal_binding_fk FOREIGN KEY ("company_id","discount_proposal_id","id","business_id","service_id") REFERENCES "public"."discount_proposals"("company_id","id","consumed_line_id","business_id","service_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint
-- الزيارة مربوطة من جهة الطلب؛ طلب من غير زيارة (session_id NULL) ما بيتفحصش، والمطابقة بتتخطّى (MATCH SIMPLE).
-- البحث بيتخدم بالفهرس الجزئي dp_consumed_line_uq (company_id, consumed_line_id) اللي بيضيّق البحث على صف واحد، فمفيش فهرس تاني لازم.
ALTER TABLE discount_proposals ADD CONSTRAINT dp_consumed_line_session_fk FOREIGN KEY ("company_id","consumed_line_id","session_id") REFERENCES "public"."service_lines"("company_id","id","session_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED NOT VALID;
--> statement-breakpoint
-- فرع الطلب لازم يكون فرع زيارته؛ الفحص فوري لأن الطلب بيتكتب قبل ما يتستهلك.
ALTER TABLE discount_proposals ADD CONSTRAINT dp_session_branch_fk FOREIGN KEY ("company_id","branch_id","session_id") REFERENCES "public"."service_sessions"("company_id","branch_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
