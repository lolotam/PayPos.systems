ALTER ROLE pospay_notifications WITH LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE pospay_suppression_reader WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
DO $$ DECLARE m record; BEGIN
  FOR m IN SELECT granted.rolname AS granted, member.rolname AS member
    FROM pg_auth_members a JOIN pg_roles granted ON granted.oid = a.roleid
    JOIN pg_roles member ON member.oid = a.member
    WHERE member.rolname IN ('pospay_notifications','pospay_suppression_reader') LOOP
    EXECUTE format('REVOKE %I FROM %I CASCADE', m.granted, m.member);
  END LOOP;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pospay_notifications', current_database());
END $$;
--> statement-breakpoint
ALTER TABLE public.platform_whatsapp_suppressions OWNER TO pospay_owner;
ALTER TABLE public.platform_whatsapp_inbox OWNER TO pospay_owner;
ALTER TABLE public.platform_whatsapp_audit OWNER TO pospay_owner;
REVOKE ALL ON public.platform_whatsapp_suppressions, public.platform_whatsapp_inbox, public.platform_whatsapp_audit FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications, pospay_suppression_reader;
GRANT USAGE ON SCHEMA public TO pospay_notifications, pospay_suppression_reader;
REVOKE CREATE ON SCHEMA public FROM pospay_notifications, pospay_suppression_reader;
GRANT SELECT ON public.platform_whatsapp_suppressions TO pospay_notifications, pospay_suppression_reader;
GRANT INSERT (recipient_hash, hash_key_id, source, first_opted_out_at, last_opted_out_at), UPDATE (source, last_opted_out_at) ON public.platform_whatsapp_suppressions TO pospay_notifications;
GRANT SELECT, INSERT ON public.platform_whatsapp_inbox TO pospay_notifications;
GRANT UPDATE (raw_event, suppression_applied_at, processed_at, enqueue_confirmed_at) ON public.platform_whatsapp_inbox TO pospay_notifications;
GRANT INSERT ON public.platform_whatsapp_audit TO pospay_notifications;
--> statement-breakpoint
CREATE FUNCTION public.platform_whatsapp_is_suppressed(recipient bytea) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF recipient IS NULL OR octet_length(recipient) <> 32 THEN
    RAISE EXCEPTION 'SUPPRESSION_HASH_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.platform_whatsapp_suppressions
    WHERE recipient_hash = recipient AND opted_back_in_at IS NULL);
END $$;
ALTER FUNCTION public.platform_whatsapp_is_suppressed(bytea) OWNER TO pospay_suppression_reader;
REVOKE ALL ON FUNCTION public.platform_whatsapp_is_suppressed(bytea) FROM PUBLIC, pospay_auth, pospay_dispatcher, pospay_notifications;
GRANT EXECUTE ON FUNCTION public.platform_whatsapp_is_suppressed(bytea) TO pospay_app;
