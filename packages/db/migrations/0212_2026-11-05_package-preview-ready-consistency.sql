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
        OR (to_jsonb(NEW) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code'])
           IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','row_count','error_count','skipped_count','rows','errors','error_code']) THEN
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
