-- 0215: package import commit contract and equivalent bounded slot guard.
-- PP-134: «سوال المعاينة القديمة نرفضها ونقبل معاينة جديده».
-- No backfill, reread, or existing-row mutation. 0211/0212/0213 remain immutable.
ALTER TABLE import_previews ADD COLUMN commit_membership_id uuid;
--> statement-breakpoint
ALTER TABLE import_previews ADD CONSTRAINT import_previews_commit_membership_fk
  FOREIGN KEY(company_id,created_by,commit_membership_id) REFERENCES memberships(company_id,user_id,id) NOT VALID;
--> statement-breakpoint
GRANT UPDATE(commit_membership_id) ON import_previews TO pospay_app;
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
  IF NEW.commit_membership_id IS DISTINCT FROM OLD.commit_membership_id AND NOT
    (OLD.entity='packages' AND OLD.status='ready' AND NEW.status='commit_requested'
      AND OLD.commit_membership_id IS NULL AND NEW.commit_membership_id IS NOT NULL) THEN
    RAISE EXCEPTION 'IMPORT_PREVIEW_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.entity='packages' THEN
    IF OLD.status='ready' THEN
      IF NEW.status='commit_requested' AND (NEW.source_rows IS NULL OR NEW.skipped_rows IS NULL) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_EXPIRED' USING ERRCODE='23514';
      END IF;
      IF NEW.status='commit_requested' AND (NEW.commit_membership_id IS NULL OR NEW.requested_at IS NULL
        OR NEW.requested_at>=NEW.expires_at OR NEW.error_count<>0) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
      END IF;
      IF (NEW.status='ready' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) OR
        (NEW.status='commit_requested' AND
          (to_jsonb(NEW)-ARRAY['status','requested_at','commit_membership_id']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['status','requested_at','commit_membership_id'])) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
      END IF;
    END IF;
    IF OLD.status='commit_requested' THEN
      IF NEW.status='committed' THEN
        IF NEW.created_count>OLD.row_count-OLD.skipped_count OR
          (to_jsonb(NEW)-ARRAY['status','committed_at','created_count']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['status','committed_at','created_count']) THEN
          RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.status='failed' THEN
        IF (to_jsonb(NEW)-ARRAY['status','error_code']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['status','error_code']) THEN
          RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.status<>'commit_requested' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
        RAISE EXCEPTION 'IMPORT_PREVIEW_TRANSITION_INVALID' USING ERRCODE='23514';
      END IF;
    END IF;
    IF OLD.status='failed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_FAILED_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.status='committed' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
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
CREATE OR REPLACE FUNCTION package_import_preview_partition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  source_ordinals integer[];
  skipped_ordinals integer[];
  partition_ordinals integer[];
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_rows IS NOT NULL OR NEW.skipped_rows IS NOT NULL OR NEW.commit_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.source_rows,NEW.skipped_rows) IS DISTINCT FROM (OLD.source_rows,OLD.skipped_rows)
    AND (OLD.entity<>'packages' OR OLD.status<>'pending' OR NEW.status<>'ready') THEN
    RAISE EXCEPTION 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.entity='packages' AND OLD.status='pending' AND NEW.status='ready' THEN
    -- Contract: only the proof-writing 47-2a worker is a supported rollback floor.
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
-- نفس حواجز الجلسات على مفاتيح مميزة وحدود كل مكوّن؛ تكرار آلاف الجلسات لا يضيف فحصًا جديدًا للأب.
CREATE OR REPLACE FUNCTION package_session_slots_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE sid bigint; v_xid xid8;
BEGIN
  sid := public.pospay_system_id();
  IF sid IS NULL OR sid = 0 THEN
    RAISE EXCEPTION 'the cluster system identifier is unavailable';
  END IF;
  v_xid := pg_current_xact_id();
  IF EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT company_id,business_id,entitlement_id FROM new_slots
    ) s
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
    SELECT 1 FROM (
      SELECT DISTINCT company_id,business_id,entitlement_id,state FROM new_slots
    ) s
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
    SELECT 1 FROM (
      SELECT company_id,business_id,entitlement_id,component_id,min(ordinal) AS first_ordinal,max(ordinal) AS last_ordinal
      FROM new_slots GROUP BY company_id,business_id,entitlement_id,component_id
    ) s
    JOIN public.package_components c
      ON c.company_id = s.company_id AND c.business_id = s.business_id
      AND c.entitlement_id = s.entitlement_id AND c.id = s.component_id
    WHERE s.first_ordinal < 1 OR s.last_ordinal > c.sessions_total
  ) THEN
    RAISE EXCEPTION 'the ordinal of a session is outside the sessions of its component'
      USING ERRCODE = '23514', CONSTRAINT = 'package_session_slots_ordinal_range';
  END IF;
  RETURN NULL;
END $$;
