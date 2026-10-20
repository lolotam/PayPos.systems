-- التبديل بياخد قفل حصري؛ المهلة القصيرة تخلّي الهجرة تفشل بسرعة وتتعاد بدل ما تقف ورا الحركة.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- لو بناء 0159 اتقطع ممكن يسيب فهرس INVALID (زي #293)؛ ربط قيد بفهرس مش صالح ممنوع، فبنرفض برسالة واضحة.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.session_tip_revisions_session_seal_key') AND i.indisvalid AND i.indisready
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    WHERE i.indexrelid = to_regclass('public.slpc_line_seal_key') AND i.indisvalid AND i.indisready
  ) THEN
    RAISE EXCEPTION 'write-seal unique index from 0159 is missing or INVALID; drop it and rerun the migration (ADR-0033)';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE session_tip_revisions DROP CONSTRAINT session_tip_revisions_session_xid_uq;
--> statement-breakpoint
ALTER TABLE session_tip_revisions ADD CONSTRAINT session_tip_revisions_session_xid_uq UNIQUE USING INDEX session_tip_revisions_session_seal_key;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes DROP CONSTRAINT slpc_line_xid_uq;
--> statement-breakpoint
ALTER TABLE service_line_performer_changes ADD CONSTRAINT slpc_line_xid_uq UNIQUE USING INDEX slpc_line_seal_key;
