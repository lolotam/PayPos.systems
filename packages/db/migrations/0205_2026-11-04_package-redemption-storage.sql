-- PP-123: expand storage with short metadata locks; index builds and FK validation follow in 0206.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.service_lines ADD COLUMN redemption_id uuid;
CREATE TABLE public.package_redemptions (
  company_id uuid NOT NULL CONSTRAINT package_redemptions_company_id_companies_id_fk REFERENCES public.companies(id), id uuid NOT NULL,
  business_id uuid NOT NULL, entitlement_id uuid NOT NULL, component_id uuid NOT NULL,
  slot_id uuid NOT NULL, line_id uuid NOT NULL, redeemed_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL CONSTRAINT package_redemptions_recorded_by_user_id_fk REFERENCES public."user"(id), recorded_by_membership_id uuid NOT NULL,
  reversed_at timestamptz, reversal_cancellation_id uuid,
  CONSTRAINT package_redemptions_pkey PRIMARY KEY(company_id,id),
  CONSTRAINT package_redemptions_business_id_key UNIQUE(company_id,business_id,id),
  CONSTRAINT package_redemptions_line_key UNIQUE(company_id,line_id),
  CONSTRAINT package_redemptions_reversal_pair CHECK ((reversed_at IS NULL) = (reversal_cancellation_id IS NULL)),
  CONSTRAINT package_redemptions_component_fk FOREIGN KEY(company_id,business_id,entitlement_id,component_id)
    REFERENCES public.package_components(company_id,business_id,entitlement_id,id),
  CONSTRAINT package_redemptions_membership_fk FOREIGN KEY(company_id,recorded_by,recorded_by_membership_id)
    REFERENCES public.memberships(company_id,user_id,id),
  CONSTRAINT package_redemptions_slot_fk FOREIGN KEY(company_id,business_id,slot_id)
    REFERENCES public.package_session_slots(company_id,business_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT package_redemptions_line_fk FOREIGN KEY(company_id,business_id,line_id)
    REFERENCES public.service_lines(company_id,business_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT package_redemptions_cancellation_fk FOREIGN KEY(company_id,reversal_cancellation_id)
    REFERENCES public.service_line_cancellations(company_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.service_lines ADD CONSTRAINT service_lines_redemption_fk
  FOREIGN KEY(company_id,business_id,redemption_id) REFERENCES public.package_redemptions(company_id,business_id,id) DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE public.package_session_slots ADD CONSTRAINT package_session_slots_redemption_fk
  FOREIGN KEY(company_id,business_id,current_redemption_id) REFERENCES public.package_redemptions(company_id,business_id,id) DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE public.package_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY package_redemptions_select ON public.package_redemptions FOR SELECT TO pospay_app USING(company_id = public.app_company_id());
CREATE POLICY package_redemptions_insert ON public.package_redemptions FOR INSERT TO pospay_app WITH CHECK(company_id = public.app_company_id());
CREATE POLICY package_redemptions_update ON public.package_redemptions FOR UPDATE TO pospay_app USING(company_id = public.app_company_id()) WITH CHECK(company_id = public.app_company_id());
REVOKE ALL ON public.package_redemptions FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
GRANT SELECT, INSERT ON public.package_redemptions TO pospay_app;
GRANT UPDATE(reversed_at,reversal_cancellation_id) ON public.package_redemptions TO pospay_app;

-- OLD/NEW choose identities only. Every deferred assertion reads current rows.
CREATE FUNCTION public.package_redemptions_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reversed_at IS NOT NULL OR NEW.reversal_cancellation_id IS NOT NULL THEN
      RAISE EXCEPTION 'redemption starts live' USING ERRCODE='23514', CONSTRAINT='package_redemptions_write_guard';
    END IF;
  ELSIF OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL OR NEW.reversal_cancellation_id IS NULL
    OR (to_jsonb(OLD) - 'reversed_at' - 'reversal_cancellation_id') IS DISTINCT FROM
       (to_jsonb(NEW) - 'reversed_at' - 'reversal_cancellation_id') THEN
    RAISE EXCEPTION 'only one paired reversal is allowed' USING ERRCODE='23514', CONSTRAINT='package_redemptions_write_guard';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_redemptions_write_guard BEFORE INSERT OR UPDATE ON public.package_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.package_redemptions_write_guard();

CREATE FUNCTION public.service_lines_redemption_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.redemption_id IS DISTINCT FROM OLD.redemption_id OR (OLD.redemption_id IS NOT NULL AND
    ROW(NEW.list_price,NEW.price,NEW.discount,NEW.net,NEW.effective_discount_bps) IS DISTINCT FROM
    ROW(OLD.list_price,OLD.price,OLD.discount,OLD.net,OLD.effective_discount_bps)) THEN
    RAISE EXCEPTION 'redemption marker and money are immutable' USING ERRCODE='23514', CONSTRAINT='service_lines_redemption_guard';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_lines_redemption_guard BEFORE UPDATE ON public.service_lines
  FOR EACH ROW EXECUTE FUNCTION public.service_lines_redemption_guard();

CREATE OR REPLACE FUNCTION public.package_session_slots_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.state NOT IN ('FREE','USED') OR NEW.state NOT IN ('FREE','USED') THEN
    RAISE EXCEPTION 'terminal and refund transitions remain closed' USING ERRCODE='23514', CONSTRAINT='package_session_slots_state_closed';
  END IF;
  IF (to_jsonb(OLD) - 'state' - 'current_redemption_id') IS DISTINCT FROM
     (to_jsonb(NEW) - 'state' - 'current_redemption_id') THEN
    RAISE EXCEPTION 'slot identity and value are immutable' USING ERRCODE='23514', CONSTRAINT='package_session_slots_immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.package_redemption_validate_slot(tenant uuid, business uuid, slot uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE s public.package_session_slots%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.package_session_slots
    WHERE company_id=tenant AND business_id=business AND id=slot FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redemption slot is missing or hidden' USING ERRCODE='23514', CONSTRAINT='package_redemption_slot_complete';
  END IF;
  IF s.state='USED' THEN
    IF NOT EXISTS (SELECT 1 FROM public.package_redemptions r
      WHERE r.company_id=tenant AND r.business_id=business AND r.id=s.current_redemption_id
        AND r.slot_id=s.id AND r.entitlement_id=s.entitlement_id AND r.component_id=s.component_id AND r.reversed_at IS NULL) THEN
      RAISE EXCEPTION 'USED slot needs its exact live redemption' USING ERRCODE='23514', CONSTRAINT='package_redemption_slot_complete';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.package_redemptions r WHERE r.company_id=tenant
    AND r.business_id=business AND r.slot_id=s.id AND r.reversed_at IS NULL
    AND (s.state<>'USED' OR r.id IS DISTINCT FROM s.current_redemption_id)) THEN
    RAISE EXCEPTION 'slot cannot abandon a live redemption' USING ERRCODE='23514', CONSTRAINT='package_redemption_slot_complete';
  END IF;
END $$;

CREATE FUNCTION public.package_redemption_validate(tenant uuid, redemption uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE r public.package_redemptions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.package_redemptions WHERE company_id=tenant AND id=redemption;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redemption is missing or hidden' USING ERRCODE='23514', CONSTRAINT='package_redemption_complete';
  END IF;
  PERFORM public.package_redemption_validate_slot(r.company_id,r.business_id,r.slot_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.service_lines l
    JOIN public.service_sessions v ON v.company_id=l.company_id AND v.business_id=l.business_id AND v.id=l.session_id
    JOIN public.package_entitlements e ON e.company_id=r.company_id AND e.business_id=r.business_id AND e.id=r.entitlement_id
    JOIN public.package_components c ON c.company_id=e.company_id AND c.business_id=e.business_id AND c.entitlement_id=e.id AND c.id=r.component_id
    JOIN public.package_session_slots s ON s.company_id=c.company_id AND s.business_id=c.business_id AND s.entitlement_id=c.entitlement_id AND s.component_id=c.id AND s.id=r.slot_id
    WHERE l.company_id=r.company_id AND l.business_id=r.business_id AND l.id=r.line_id AND l.redemption_id=r.id
      AND v.customer_id=e.customer_id AND l.service_id=c.service_id
      AND l.list_price=s.unit_value AND l.price=s.unit_value AND l.net=s.unit_value
      AND l.discount=0 AND l.effective_discount_bps=0
      AND ((r.reversed_at IS NULL AND l.status='ACTIVE' AND s.state='USED' AND s.current_redemption_id=r.id)
        OR (r.reversed_at IS NOT NULL AND l.status='CANCELLED' AND EXISTS (
          SELECT 1 FROM public.service_line_cancellations x WHERE x.company_id=l.company_id
            AND x.business_id=l.business_id AND x.line_id=l.id AND x.id=r.reversal_cancellation_id
            AND x.revision=l.revision AND x.previous_revision::bigint=l.revision::bigint-1
            AND x.previous_price=l.price AND x.previous_discount=l.discount AND x.previous_net=l.net)))
  ) THEN
    RAISE EXCEPTION 'redemption line, customer, service, money or reversal mismatch' USING ERRCODE='23514', CONSTRAINT='package_redemption_complete';
  END IF;
END $$;

CREATE FUNCTION public.package_redemption_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE marker uuid;
BEGIN
  IF TG_TABLE_NAME='package_redemptions' THEN
    PERFORM public.package_redemption_validate(NEW.company_id,NEW.id);
  ELSIF TG_TABLE_NAME='service_lines' THEN
    SELECT redemption_id INTO marker FROM public.service_lines WHERE company_id=NEW.company_id AND id=NEW.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'redemption line is missing or hidden' USING ERRCODE='23514', CONSTRAINT='package_redemption_complete';
    END IF;
    IF marker IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.package_redemptions r WHERE r.company_id=NEW.company_id
        AND r.business_id=NEW.business_id AND r.id=marker AND r.line_id=NEW.id) THEN
        RAISE EXCEPTION 'line must own its reciprocal redemption' USING ERRCODE='23514', CONSTRAINT='package_redemption_complete';
      END IF;
      PERFORM public.package_redemption_validate(NEW.company_id,marker);
    END IF;
  ELSE
    PERFORM public.package_redemption_validate_slot(NEW.company_id,NEW.business_id,NEW.id);
    -- Removed pointers must be checked even after an earlier constraint flush.
    IF TG_OP='UPDATE' AND OLD.current_redemption_id IS NOT NULL THEN
      PERFORM public.package_redemption_validate(OLD.company_id,OLD.current_redemption_id);
    END IF;
    SELECT current_redemption_id INTO marker FROM public.package_session_slots WHERE company_id=NEW.company_id AND id=NEW.id;
    IF marker IS NOT NULL THEN PERFORM public.package_redemption_validate(NEW.company_id,marker); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER package_redemptions_complete AFTER INSERT OR UPDATE ON public.package_redemptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.package_redemption_complete();
CREATE CONSTRAINT TRIGGER service_lines_redemption_complete AFTER INSERT OR UPDATE ON public.service_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.redemption_id IS NOT NULL)
  EXECUTE FUNCTION public.package_redemption_complete();
CREATE CONSTRAINT TRIGGER package_session_slots_redemption_complete AFTER UPDATE OF state, current_redemption_id ON public.package_session_slots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.current_redemption_id IS DISTINCT FROM NEW.current_redemption_id)
  EXECUTE FUNCTION public.package_redemption_complete();
REVOKE ALL ON FUNCTION public.package_redemptions_write_guard(), public.service_lines_redemption_guard(),
  public.package_redemption_validate_slot(uuid,uuid,uuid), public.package_redemption_validate(uuid,uuid),
  public.package_redemption_complete() FROM PUBLIC, pospay_auth, pospay_dispatcher;
GRANT EXECUTE ON FUNCTION public.package_redemptions_write_guard(), public.service_lines_redemption_guard(),
  public.package_redemption_validate_slot(uuid,uuid,uuid), public.package_redemption_validate(uuid,uuid),
  public.package_redemption_complete() TO pospay_app;
