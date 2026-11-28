-- PP-286 T-3 (#452 item 1): persist each visit's first computed rating_request_day (immutable once set).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "service_sessions" ADD COLUMN "rating_request_day" date;
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