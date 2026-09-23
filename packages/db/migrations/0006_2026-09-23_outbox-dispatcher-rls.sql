-- The outbox dispatcher's role and the consumers' dedupe table — ADR-0003 §3 (pospay_dispatcher), plan v4 T7b.
-- The privilege suite fails on any grant not listed in its allowlist.

-- pospay_dispatcher: the one cross-tenant reader, on outbox ONLY. Its policies are role-scoped and read no
-- context — the single documented exception to the app_company_id() rule. Column grants keep id, company_id,
-- aggregate, event type and payload immutable to it; it may only record delivery metadata.
GRANT USAGE ON SCHEMA public TO pospay_dispatcher;
--> statement-breakpoint
CREATE POLICY outbox_dispatcher_select ON outbox FOR SELECT TO pospay_dispatcher
  USING (true);
--> statement-breakpoint
CREATE POLICY outbox_dispatcher_update ON outbox FOR UPDATE TO pospay_dispatcher
  USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON outbox TO pospay_dispatcher;
--> statement-breakpoint
GRANT UPDATE (published_at, attempts, last_error, next_attempt_at, parked_at) ON outbox TO pospay_dispatcher;
--> statement-breakpoint

-- consumed_events: tenant data written by consumers as pospay_app, inside withTenant(event.company_id), in the
-- same transaction as the effect. Insert-only: a dedupe row is never changed or removed by the app.
ALTER TABLE consumed_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consumed_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY consumed_events_select ON consumed_events FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY consumed_events_insert ON consumed_events FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON consumed_events TO pospay_app;
--> statement-breakpoint

-- The 24 h idempotency sweep (plan v4 T7). It must reach every tenant's expired keys, which no runtime role can
-- see, so it is one fixed-purpose SECURITY DEFINER function: it deletes only expired rows, takes only a batch size,
-- pins search_path, and only pospay_dispatcher may execute it.
CREATE FUNCTION sweep_expired_idempotency_keys(batch_size integer) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH doomed AS (
    SELECT scope_type, scope_id, operation, key FROM public.idempotency_keys
    WHERE expires_at < now()
    ORDER BY expires_at
    LIMIT least(greatest(batch_size, 1), 10000)
    FOR UPDATE SKIP LOCKED
  ), gone AS (
    DELETE FROM public.idempotency_keys k USING doomed d
    WHERE k.scope_type = d.scope_type AND k.scope_id = d.scope_id
      AND k.operation = d.operation AND k.key = d.key
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sweep_expired_idempotency_keys(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sweep_expired_idempotency_keys(integer) TO pospay_dispatcher;
