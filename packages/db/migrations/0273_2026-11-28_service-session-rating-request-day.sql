-- PP-286 T-3 (#452 item 1): persist each visit's first computed rating_request_day (immutable once set).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "service_sessions" ADD COLUMN "rating_request_day" date;
--> statement-breakpoint
UPDATE public.service_sessions AS s
SET rating_request_day = (
  SELECT r.business_date
  FROM public.branches AS b
  JOIN public.businesses AS bu
    ON bu.company_id = b.company_id
    AND bu.id = b.business_id
  JOIN public.rating_requests AS r
    ON r.company_id = s.company_id
    AND r.business_id = s.business_id
    AND r.customer_id = s.customer_id
  JOIN public.branches AS rb
    ON rb.company_id = r.company_id
    AND rb.business_id = r.business_id
    AND rb.id = r.branch_id
  JOIN public.businesses AS rbu
    ON rbu.company_id = rb.company_id
    AND rbu.id = rb.business_id
  WHERE b.company_id = s.company_id
    AND b.business_id = s.business_id
    AND b.id = s.branch_id
    AND (
      (
        (s.occurred_at AT TIME ZONE COALESCE(b.timezone, bu.timezone))::date = r.business_date
        AND s.occurred_at <= COALESCE(r.send_deadline, r.due_at)
      )
      OR (
        r.branch_id = s.branch_id
        AND (s.occurred_at AT TIME ZONE COALESCE(b.timezone, bu.timezone))::date = r.business_date + 1
        AND r.send_deadline IS NOT NULL
        AND ((r.send_deadline - interval '30 minutes') AT TIME ZONE COALESCE(rb.timezone, rbu.timezone))::date > r.business_date
        AND s.occurred_at < (r.send_deadline - interval '30 minutes')
      )
    )
  ORDER BY r.business_date ASC
  LIMIT 1
)
WHERE s.rating_request_day IS NULL
  AND s.customer_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.rating_requests AS r
    WHERE r.company_id = s.company_id
      AND r.business_id = s.business_id
      AND r.customer_id = s.customer_id
  );
--> statement-breakpoint
GRANT UPDATE (rating_request_day) ON service_sessions TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION public.enforce_service_session_rating_request_day_set_once() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.rating_request_day IS NULL
     OR (OLD.rating_request_day IS NOT NULL AND NEW.rating_request_day IS DISTINCT FROM OLD.rating_request_day) THEN
    RAISE EXCEPTION 'service_sessions rating_request_day is immutable once set'
      USING ERRCODE = '23514', CONSTRAINT = 'service_sessions_rating_request_day_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_service_session_rating_request_day_set_once() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.enforce_service_session_rating_request_day_set_once() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER service_sessions_rating_request_day_set_once
  BEFORE UPDATE OF rating_request_day ON service_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_session_rating_request_day_set_once();