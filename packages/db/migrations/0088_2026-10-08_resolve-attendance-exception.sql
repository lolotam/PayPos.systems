ALTER TABLE "attendance_exceptions" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_resolution" CHECK ("attendance_exceptions"."resolution" IS NULL OR "attendance_exceptions"."resolution" IN ('CLOSED_LATE','MISSED_OUT','ACKNOWLEDGED','CARD_SCAN')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_open_clear" CHECK ("attendance_exceptions"."status" <> 'OPEN' OR ("attendance_exceptions"."resolution" IS NULL AND "attendance_exceptions"."resolved_by" IS NULL AND "attendance_exceptions"."resolved_at" IS NULL AND "attendance_exceptions"."reason" IS NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_resolved_set" CHECK ("attendance_exceptions"."status" <> 'RESOLVED' OR ("attendance_exceptions"."resolution" IS NOT NULL AND "attendance_exceptions"."resolved_at" IS NOT NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_reason_bounds" CHECK ("attendance_exceptions"."reason" IS NULL OR ("attendance_exceptions"."reason" = btrim("attendance_exceptions"."reason") AND char_length("attendance_exceptions"."reason") BETWEEN 1 AND 500)) NOT VALID;
--> statement-breakpoint
UPDATE attendance_exceptions AS e
SET status = 'RESOLVED', resolution = 'CARD_SCAN', resolved_by = NULL, reason = NULL, resolved_at = clock_timestamp()
FROM attendance_sessions AS s
WHERE e.company_id = s.company_id AND e.session_id = s.id AND e.status = 'OPEN' AND e.kind = 'NONE'
  AND ((s.source = 'BARCODE' AND e.raised_at = s.clock_in) OR (s.out_operator_id IS NOT NULL AND s.clock_out IS NOT NULL AND e.raised_at = s.clock_out));
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" VALIDATE CONSTRAINT "attendance_exceptions_resolution";
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" VALIDATE CONSTRAINT "attendance_exceptions_open_clear";
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" VALIDATE CONSTRAINT "attendance_exceptions_resolved_set";
--> statement-breakpoint
ALTER TABLE "attendance_exceptions" VALIDATE CONSTRAINT "attendance_exceptions_reason_bounds";
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('resolve:attendance:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,p.code FROM roles r CROSS JOIN permissions p
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
AND p.code = 'resolve:attendance:branch' ON CONFLICT DO NOTHING;
