INSERT INTO permissions(code) VALUES ('import:packages:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'import:packages:business' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "import_previews" DROP CONSTRAINT "import_previews_status";--> statement-breakpoint
ALTER TABLE "import_previews" ADD COLUMN "skipped_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_pending" CHECK ("import_previews"."status" <> 'pending' OR ("import_previews"."entity"='packages'
      AND "import_previews"."row_count"=0 AND "import_previews"."error_count"=0 AND "import_previews"."skipped_count"=0
      AND "import_previews"."rows"='[]'::jsonb AND "import_previews"."errors"='[]'::jsonb
      AND "import_previews"."requested_at" IS NULL AND "import_previews"."error_code" IS NULL));--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_skipped" CHECK ("import_previews"."skipped_count" BETWEEN 0 AND "import_previews"."row_count" AND ("import_previews"."entity"='packages' OR "import_previews"."skipped_count"=0));--> statement-breakpoint
ALTER TABLE "import_previews" ADD CONSTRAINT "import_previews_status" CHECK ("import_previews"."status" IN ('pending','ready','commit_requested','committed','failed'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION package_import_preview_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF (NEW.row_count,NEW.error_count,NEW.skipped_count,NEW.rows,NEW.errors)
     IS DISTINCT FROM (OLD.row_count,OLD.error_count,OLD.skipped_count,OLD.rows,OLD.errors) THEN
    IF OLD.entity <> 'packages' OR OLD.status <> 'pending' OR NEW.status NOT IN ('ready','failed') THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.entity='packages' THEN
    IF OLD.status='failed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_FAILED_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN ('commit_requested','committed') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
    END IF;
    IF (NEW.status='pending' AND OLD.status<>'pending')
      OR (OLD.status='ready' AND NEW.status NOT IN ('ready','commit_requested'))
      OR (OLD.status='failed' AND NEW.status<>'failed') THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
    END IF;
    IF OLD.status='pending' THEN
      IF NEW.status NOT IN ('pending','ready','failed')
        OR (to_jsonb(NEW) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code'])
           IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code']) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
      END IF;
      IF NEW.status='ready' AND NEW.error_code IS NOT NULL THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_READY_ERROR_INVALID' USING ERRCODE='23514';
      END IF;
      IF NEW.status='failed' AND (NEW.row_count<>0 OR NEW.error_count<>0 OR NEW.skipped_count<>0
        OR NEW.rows<>'[]'::jsonb OR NEW.errors<>'[]'::jsonb) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_FAILED_RESULTS_INVALID' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION package_import_preview_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION package_import_preview_update_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER package_import_preview_update_guard
BEFORE UPDATE ON import_previews FOR EACH ROW EXECUTE FUNCTION package_import_preview_update_guard();
--> statement-breakpoint
GRANT UPDATE(row_count,error_count,skipped_count,rows,errors) ON import_previews TO pospay_app;
