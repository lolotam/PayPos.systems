-- 47-2a / PP-134 / #876: nullable ordinal proof; no backfill or legacy data update.
ALTER TABLE "import_previews" ADD COLUMN "source_rows" jsonb;--> statement-breakpoint
ALTER TABLE "import_previews" ADD COLUMN "skipped_rows" jsonb;
--> statement-breakpoint
-- 47-1b / #863: enforce consistent package preview results before activation.
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
        OR (to_jsonb(NEW) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code','source_rows','skipped_rows'])
           IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code','source_rows','skipped_rows']) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
      END IF;
      IF NEW.status='ready' THEN
        IF jsonb_typeof(NEW.rows) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.errors) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
        END IF;
        IF NEW.error_count<>jsonb_array_length(NEW.errors)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.rows || NEW.errors) e
            WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
              OR jsonb_typeof(e->'row') IS DISTINCT FROM 'number'
              OR NOT CASE WHEN e->>'row' ~ '^[0-9]{1,3}$' THEN (e->>'row')::int BETWEEN 2 AND 502 ELSE false END) THEN
          RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
        END IF;
        IF jsonb_array_length(NEW.rows)<>(SELECT count(DISTINCT (e->>'row')::int) FROM jsonb_array_elements(NEW.rows) e)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.rows) r JOIN jsonb_array_elements(NEW.errors) e ON (r->>'row')::int=(e->>'row')::int)
          OR jsonb_array_length(NEW.rows)+NEW.skipped_count+(SELECT count(DISTINCT (e->>'row')::int) FROM jsonb_array_elements(NEW.errors) e)<>NEW.row_count THEN
          RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
        END IF;
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
-- 0212's refusals above are preserved; only the pending result-column allowlist expands.
-- This trigger runs after package_import_preview_update_guard (PostgreSQL name order),
-- so its ready-row casts rely on the already-validated 0212 result shapes and ordinals.
CREATE FUNCTION package_import_preview_partition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  source_ordinals integer[];
  skipped_ordinals integer[];
  partition_ordinals integer[];
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_rows IS NOT NULL OR NEW.skipped_rows IS NOT NULL THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.source_rows,NEW.skipped_rows) IS DISTINCT FROM (OLD.source_rows,OLD.skipped_rows)
    AND (OLD.entity<>'packages' OR OLD.status<>'pending' OR NEW.status<>'ready') THEN
    RAISE EXCEPTION 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.entity='packages' AND OLD.status='ready' AND NEW.status='commit_requested'
    AND (OLD.source_rows IS NULL OR OLD.skipped_rows IS NULL) THEN
    -- PP-134: legacy previews require a new preview; never fabricate or backfill proof.
    RAISE EXCEPTION 'IMPORT_PREVIEW_EXPIRED' USING ERRCODE='23514';
  END IF;
  IF OLD.entity='packages' AND OLD.status='pending' AND NEW.status='ready' THEN
    IF jsonb_typeof(NEW.source_rows) IS DISTINCT FROM 'array'
      OR jsonb_typeof(NEW.skipped_rows) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(NEW.source_rows)<>NEW.row_count
      OR jsonb_array_length(NEW.skipped_rows)<>NEW.skipped_count
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.source_rows || NEW.skipped_rows) e
        WHERE jsonb_typeof(e) IS DISTINCT FROM 'number'
          OR NOT CASE WHEN e#>>'{}' ~ '^[0-9]{1,3}$'
            THEN (e#>>'{}')::int BETWEEN 2 AND 502 ELSE false END) THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
    END IF;
    source_ordinals := ARRAY(SELECT (e#>>'{}')::int
      FROM jsonb_array_elements(NEW.source_rows) e ORDER BY 1);
    skipped_ordinals := ARRAY(SELECT (e#>>'{}')::int
      FROM jsonb_array_elements(NEW.skipped_rows) e ORDER BY 1);
    IF cardinality(source_ordinals)<>(SELECT count(DISTINCT n) FROM unnest(source_ordinals) n)
      OR cardinality(skipped_ordinals)<>(SELECT count(DISTINCT n) FROM unnest(skipped_ordinals) n) THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
    END IF;
    -- 0212 already proves valid/invalid disjointness and the total count. Equality
    -- with this union also proves skipped disjointness and exact source coverage.
    partition_ordinals := ARRAY(SELECT n FROM (
      SELECT (e->>'row')::int AS n FROM jsonb_array_elements(NEW.rows) e
      UNION SELECT (e->>'row')::int FROM jsonb_array_elements(NEW.errors) e
      UNION SELECT n FROM unnest(skipped_ordinals) n
    ) ordinals ORDER BY n);
    IF source_ordinals IS DISTINCT FROM partition_ordinals THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_READY_RESULTS_INVALID' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION package_import_preview_partition_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION package_import_preview_partition_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER zz_package_import_preview_partition_guard
BEFORE INSERT OR UPDATE ON import_previews FOR EACH ROW
EXECUTE FUNCTION package_import_preview_partition_guard();
--> statement-breakpoint
GRANT UPDATE(source_rows,skipped_rows) ON import_previews TO pospay_app;
