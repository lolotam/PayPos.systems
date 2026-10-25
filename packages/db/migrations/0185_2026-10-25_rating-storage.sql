CREATE TABLE "rating_performers" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	CONSTRAINT "rating_performers_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "rating_performers_request_employee_key" UNIQUE("company_id","business_id","request_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "rating_requests" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"branch_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"send_deadline" timestamp with time zone,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"cancel_reason" text,
	"token_hash" "bytea",
	"token_key_version" smallint,
	"expires_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"ready_event_id" uuid,
	"sent_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"claim_xact_id" "xid8",
	"consume_xact_id" "xid8",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_requests_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "rating_requests_day_key" UNIQUE("company_id","business_id","customer_id","business_date"),
	CONSTRAINT "rating_requests_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "rating_requests_branch_id_key" UNIQUE("company_id","business_id","branch_id","id"),
	CONSTRAINT "rating_requests_status" CHECK ("rating_requests"."status" IN ('SCHEDULED','SENDING','SENT','CANCELLED')),
	CONSTRAINT "rating_requests_cancel_reason" CHECK ("rating_requests"."cancel_reason" IS NULL OR "rating_requests"."cancel_reason" IN ('NO_ACTIVE_LINE','PAST_DEADLINE','OPTED_OUT')),
	CONSTRAINT "rating_requests_cancel_pair" CHECK (("rating_requests"."status" = 'CANCELLED') = ("rating_requests"."cancel_reason" IS NOT NULL)),
	CONSTRAINT "rating_requests_token_group" CHECK (("rating_requests"."token_key_version" IS NULL) = ("rating_requests"."token_hash" IS NULL)
      AND ("rating_requests"."expires_at" IS NULL) = ("rating_requests"."token_hash" IS NULL)
      AND ("rating_requests"."claimed_at" IS NULL) = ("rating_requests"."token_hash" IS NULL)
      AND ("rating_requests"."ready_event_id" IS NULL) = ("rating_requests"."token_hash" IS NULL)),
	CONSTRAINT "rating_requests_token_status" CHECK (("rating_requests"."status" IN ('SENDING','SENT')) = ("rating_requests"."token_hash" IS NOT NULL)),
	CONSTRAINT "rating_requests_token_hash_len" CHECK ("rating_requests"."token_hash" IS NULL OR octet_length("rating_requests"."token_hash") = 32),
	CONSTRAINT "rating_requests_key_version" CHECK ("rating_requests"."token_key_version" IS NULL OR "rating_requests"."token_key_version" > 0),
	CONSTRAINT "rating_requests_expiry" CHECK ("rating_requests"."token_hash" IS NULL OR "rating_requests"."expires_at" = "rating_requests"."claimed_at" + interval '168 hours'),
	CONSTRAINT "rating_requests_sent_pair" CHECK (("rating_requests"."status" = 'SENT') = ("rating_requests"."sent_at" IS NOT NULL)),
	CONSTRAINT "rating_requests_consumed_token" CHECK ("rating_requests"."consumed_at" IS NULL OR "rating_requests"."token_hash" IS NOT NULL),
	CONSTRAINT "rating_requests_consumed_window" CHECK ("rating_requests"."consumed_at" IS NULL OR ("rating_requests"."consumed_at" >= "rating_requests"."claimed_at" AND "rating_requests"."consumed_at" < "rating_requests"."expires_at")),
	CONSTRAINT "rating_requests_proofs" CHECK (("rating_requests"."claim_xact_id" IS NOT NULL) = ("rating_requests"."token_hash" IS NOT NULL)
      AND ("rating_requests"."consume_xact_id" IS NOT NULL) = ("rating_requests"."consumed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ratings_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "ratings_request_key" UNIQUE("company_id","request_id"),
	CONSTRAINT "ratings_attribution_key" UNIQUE("company_id","id","request_id","business_id","branch_id","stars","submitted_at"),
	CONSTRAINT "ratings_stars" CHECK ("ratings"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "ratings_comment_length" CHECK ("ratings"."comment" IS NULL OR char_length("ratings"."comment") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "rating_attributions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"rating_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rating_attributions_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "rating_attributions_rating_employee_key" UNIQUE("company_id","rating_id","employee_id"),
	CONSTRAINT "rating_attributions_stars" CHECK ("rating_attributions"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "rating_performers" ADD CONSTRAINT "rating_performers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_performers" ADD CONSTRAINT "rating_performers_request_fk" FOREIGN KEY ("company_id","business_id","request_id") REFERENCES "public"."rating_requests"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_performers" ADD CONSTRAINT "rating_performers_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_requests" ADD CONSTRAINT "rating_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_requests" ADD CONSTRAINT "rating_requests_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_requests" ADD CONSTRAINT "rating_requests_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_requests" ADD CONSTRAINT "rating_requests_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_request_fk" FOREIGN KEY ("company_id","business_id","branch_id","request_id") REFERENCES "public"."rating_requests"("company_id","business_id","branch_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_attributions" ADD CONSTRAINT "rating_attributions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_attributions" ADD CONSTRAINT "rating_attributions_rating_fk" FOREIGN KEY ("company_id","rating_id","request_id","business_id","branch_id","stars","submitted_at") REFERENCES "public"."ratings"("company_id","id","request_id","business_id","branch_id","stars","submitted_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_attributions" ADD CONSTRAINT "rating_attributions_performer_fk" FOREIGN KEY ("company_id","business_id","request_id","employee_id") REFERENCES "public"."rating_performers"("company_id","business_id","request_id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rating_performers_employee_idx" ON "rating_performers" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_requests_ready_event_key" ON "rating_requests" USING btree ("company_id","ready_event_id") WHERE "rating_requests"."ready_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rating_requests_token_hash_key" ON "rating_requests" USING btree ("company_id","token_hash") WHERE "rating_requests"."token_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rating_requests_due_idx" ON "rating_requests" USING btree ("company_id","due_at","id") WHERE "rating_requests"."status" = 'SCHEDULED';--> statement-breakpoint
CREATE INDEX "rating_requests_customer_idx" ON "rating_requests" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "rating_requests_branch_idx" ON "rating_requests" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "ratings_branch_idx" ON "ratings" USING btree ("company_id","business_id","branch_id","submitted_at");--> statement-breakpoint
CREATE INDEX "ratings_request_fk_idx" ON "ratings" USING btree ("company_id","business_id","branch_id","request_id");--> statement-breakpoint
CREATE INDEX "rating_attributions_employee_idx" ON "rating_attributions" USING btree ("company_id","employee_id","submitted_at");--> statement-breakpoint
CREATE INDEX "rating_attributions_performer_idx" ON "rating_attributions" USING btree ("company_id","business_id","request_id","employee_id");--> statement-breakpoint
CREATE INDEX "rating_attributions_branch_idx" ON "rating_attributions" USING btree ("company_id","business_id","branch_id","submitted_at");
--> statement-breakpoint
ALTER TABLE rating_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_performers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_performers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ratings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_attributions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rating_attributions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rating_requests_select ON rating_requests FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_requests_insert ON rating_requests FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_requests_update ON rating_requests FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_performers_select ON rating_performers FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_performers_insert ON rating_performers FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY ratings_select ON ratings FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY ratings_insert ON ratings FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_attributions_select ON rating_attributions FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY rating_attributions_insert ON rating_attributions FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON rating_requests, rating_performers, ratings, rating_attributions FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
-- الطلبات تتغيّر في أعمدة مسارها فقط؛ الهوية واليوم ودليلا المعاملات ممنوعون على التطبيق، والجداول الثلاثة الأخرى للإدخال فقط بلا حذف.
GRANT SELECT, INSERT ON rating_requests, rating_performers, ratings, rating_attributions TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (branch_id, due_at, send_deadline, status, cancel_reason, token_hash, token_key_version, expires_at,
  claimed_at, ready_event_id, sent_at, consumed_at, updated_at) ON rating_requests TO pospay_app;
--> statement-breakpoint
-- بداية الطلب من غير ادعاء إرسال أو استهلاك تمنع تجاوز دورة الحياة، ودليلا المعاملة لا يأتيان من المتصل.
CREATE FUNCTION rating_requests_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status NOT IN ('SCHEDULED', 'CANCELLED')
     OR NEW.token_hash IS NOT NULL
     OR NEW.ready_event_id IS NOT NULL
     OR NEW.sent_at IS NOT NULL
     OR NEW.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a rating request starts scheduled or cancelled without a claim' USING ERRCODE = '23514', CONSTRAINT = 'rating_requests_insert_state';
  END IF;
  NEW.claim_xact_id := NULL;
  NEW.consume_xact_id := NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rating_requests_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rating_requests_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER rating_requests_insert_guard BEFORE INSERT ON rating_requests
FOR EACH ROW EXECUTE FUNCTION rating_requests_insert_guard();
--> statement-breakpoint
-- ثبات الهوية ولقطة المطالبة ومسار الحالة يمنع إعادة كتابة تاريخ الطلب، ودليلا المعاملة لا يقبلان قيمة من المتصل.
CREATE FUNCTION rating_requests_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  valid_transition boolean := false;
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the identity of a rating request is immutable' USING ERRCODE = '23514', CONSTRAINT = 'rating_requests_identity_immutable';
  END IF;
  IF OLD.token_hash IS NOT NULL
     AND (NEW.token_hash IS DISTINCT FROM OLD.token_hash
       OR NEW.token_key_version IS DISTINCT FROM OLD.token_key_version
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.ready_event_id IS DISTINCT FROM OLD.ready_event_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
    RAISE EXCEPTION 'the claim fields of a rating request are frozen' USING ERRCODE = '23514', CONSTRAINT = 'rating_requests_claim_frozen';
  END IF;
  IF OLD.status = 'SCHEDULED' AND NEW.status IN ('SCHEDULED', 'SENDING', 'CANCELLED') THEN
    valid_transition := true;
  ELSIF OLD.status = 'CANCELLED' THEN
    IF OLD.cancel_reason = 'NO_ACTIVE_LINE'
       AND (NEW.status = 'SCHEDULED'
         OR (NEW.status = 'CANCELLED' AND NEW.cancel_reason IN ('NO_ACTIVE_LINE', 'PAST_DEADLINE', 'OPTED_OUT'))) THEN
      valid_transition := true;
    ELSIF OLD.cancel_reason = 'PAST_DEADLINE'
       AND NEW.status = 'CANCELLED' AND NEW.cancel_reason = 'PAST_DEADLINE' THEN
      valid_transition := true;
    ELSIF OLD.cancel_reason = 'OPTED_OUT'
       AND NEW.status = 'CANCELLED' AND NEW.cancel_reason = 'OPTED_OUT' THEN
      valid_transition := true;
    END IF;
  ELSIF OLD.status = 'SENDING' AND NEW.status IN ('SENDING', 'SENT') THEN
    valid_transition := true;
  ELSIF OLD.status = 'SENT' AND NEW.status = 'SENT' THEN
    valid_transition := true;
  END IF;
  IF NOT valid_transition THEN
    RAISE EXCEPTION 'the rating request status transition is not allowed' USING ERRCODE = '23514', CONSTRAINT = 'rating_requests_transition';
  END IF;
  IF OLD.token_hash IS NULL AND NEW.token_hash IS NOT NULL THEN
    NEW.claim_xact_id := pg_current_xact_id();
  ELSE
    NEW.claim_xact_id := OLD.claim_xact_id;
  END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
    RAISE EXCEPTION 'a rating request is consumed only once' USING ERRCODE = '23514', CONSTRAINT = 'rating_requests_consumed_once';
  END IF;
  IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN
    NEW.consume_xact_id := pg_current_xact_id();
  ELSE
    NEW.consume_xact_id := OLD.consume_xact_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rating_requests_update_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rating_requests_update_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER rating_requests_update_guard BEFORE UPDATE ON rating_requests
FOR EACH ROW EXECUTE FUNCTION rating_requests_update_guard();
--> statement-breakpoint
-- لقطة النسب لا تتغير بعد المطالبة، فلا يكتبها إلا معاملتها؛ والـ savepoint لا يغيّر pg_current_xact_id().
CREATE FUNCTION rating_performers_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  request_status text;
  request_proof xid8;
BEGIN
  SELECT r.status, r.claim_xact_id INTO request_status, request_proof
    FROM public.rating_requests r
   WHERE r.company_id = NEW.company_id AND r.id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the request of a rating performer does not exist' USING ERRCODE = '23503', CONSTRAINT = 'rating_performers_request_fk';
  END IF;
  IF request_status IS DISTINCT FROM 'SENDING' OR request_proof IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'performers are inserted only by the claiming transaction' USING ERRCODE = '23514', CONSTRAINT = 'rating_performers_claim_only';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rating_performers_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rating_performers_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER rating_performers_insert_guard BEFORE INSERT ON rating_performers
FOR EACH ROW EXECUTE FUNCTION rating_performers_insert_guard();
--> statement-breakpoint
-- التقييم مرتبط بمعاملة استهلاك الرابط نفسها حتى لا ينشأ تقييم من غير استهلاك ناجح.
CREATE FUNCTION ratings_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  request_proof xid8;
BEGIN
  SELECT r.consume_xact_id INTO request_proof
    FROM public.rating_requests r
   WHERE r.company_id = NEW.company_id AND r.id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the request of a rating does not exist' USING ERRCODE = '23503', CONSTRAINT = 'ratings_request_fk';
  END IF;
  IF request_proof IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'a rating is inserted only by the consuming transaction' USING ERRCODE = '23514', CONSTRAINT = 'ratings_consume_only';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ratings_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ratings_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER ratings_insert_guard BEFORE INSERT ON ratings
FOR EACH ROW EXECUTE FUNCTION ratings_insert_guard();
--> statement-breakpoint
-- كل نسبة تثبت معاملة الاستهلاك نفسها، فلا تُنسب نتيجة إلى طلب لم يُستهلك في هذه المعاملة.
CREATE FUNCTION rating_attributions_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  request_proof xid8;
BEGIN
  SELECT r.consume_xact_id INTO request_proof
    FROM public.rating_requests r
   WHERE r.company_id = NEW.company_id AND r.id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the request of a rating attribution does not exist' USING ERRCODE = '23503', CONSTRAINT = 'rating_attributions_performer_fk';
  END IF;
  IF request_proof IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'an attribution is inserted only by the consuming transaction' USING ERRCODE = '23514', CONSTRAINT = 'rating_attributions_consume_only';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION rating_attributions_insert_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rating_attributions_insert_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER rating_attributions_insert_guard BEFORE INSERT ON rating_attributions
FOR EACH ROW EXECUTE FUNCTION rating_attributions_insert_guard();
--> statement-breakpoint
-- كل منفذ في اللقطة لازم ياخد التقييم؛ المقارنة عند الالتزام تمنع سقوط أي منفذ بصمت.
CREATE FUNCTION ratings_attributions_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  attributed_count bigint;
  performer_count bigint;
BEGIN
  SELECT count(*) INTO attributed_count
    FROM public.rating_attributions a
   WHERE a.company_id = NEW.company_id AND a.rating_id = NEW.id;
  SELECT count(*) INTO performer_count
    FROM public.rating_performers p
   WHERE p.company_id = NEW.company_id
     AND p.business_id = NEW.business_id
     AND p.request_id = NEW.request_id;
  IF attributed_count IS DISTINCT FROM performer_count THEN
    RAISE EXCEPTION 'every snapshotted performer must receive the rating' USING ERRCODE = '23514', CONSTRAINT = 'ratings_attributions_complete';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ratings_attributions_complete() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ratings_attributions_complete() TO pospay_app;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ratings_attributions_complete AFTER INSERT ON ratings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ratings_attributions_complete();