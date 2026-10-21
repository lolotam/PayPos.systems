-- ربط القيود بالفهارس وإضافة المفاتيح الأجنبية بياخد قفل؛ المهلة القصيرة تخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا الحركة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- لو بناء 0162 اتقطع ممكن يسيب فهرس INVALID (زي #293)؛ ربط قيد أو مفتاح بفهرس مش صالح ممنوع، فبنرفض برسالة واضحة.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.devices_company_branch_id_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.service_lines_discount_proposal_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.service_lines_discount_proposal_uq') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.service_line_edits_line_id_key') AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'discount proposal unique index from 0162 is missing or INVALID; drop it and rerun the migration (ADR-0033)';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE devices ADD CONSTRAINT devices_company_branch_id_key UNIQUE USING INDEX devices_company_branch_id_key;
--> statement-breakpoint
ALTER TABLE service_lines ADD CONSTRAINT service_lines_discount_proposal_key UNIQUE USING INDEX service_lines_discount_proposal_key;
--> statement-breakpoint
ALTER TABLE service_line_edits ADD CONSTRAINT service_line_edits_line_id_key UNIQUE USING INDEX service_line_edits_line_id_key;
--> statement-breakpoint
-- جهاز من فرع آخر لا يُخزَّن أبداً كجهاز القرار.
ALTER TABLE discount_proposals ADD CONSTRAINT dp_decided_device_fk FOREIGN KEY ("company_id","branch_id","decided_device_id") REFERENCES "public"."devices"("company_id","branch_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- الربط بالاتجاهين يُفحص عند الـ commit: الموافقة المستهلكة تسمّي بندها، والبند يسمّي الموافقة نفسها.
ALTER TABLE discount_proposals ADD CONSTRAINT dp_consumed_line_fk FOREIGN KEY ("company_id","consumed_line_id","id") REFERENCES "public"."service_lines"("company_id","id","discount_proposal_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- كل الصفوف القديمة discount_proposal_id فيها NULL، فالمفتاح الجديد لا يجد ما يفحصه.
ALTER TABLE service_lines ADD CONSTRAINT service_lines_discount_proposal_fk FOREIGN KEY ("company_id","discount_proposal_id","id") REFERENCES "public"."discount_proposals"("company_id","id","consumed_line_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- الموافقة المستهلكة لازم تسمّي تعديلاً حقيقياً لنفس السطر ونفس الشركة؛ الفحص يتأجل لحد الـ commit، والقيمة الفارغة تُتخطّى (MATCH SIMPLE).
ALTER TABLE discount_proposals ADD CONSTRAINT dp_consumed_edit_fk FOREIGN KEY ("company_id","line_id","consumed_edit_id") REFERENCES "public"."service_line_edits"("company_id","line_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
