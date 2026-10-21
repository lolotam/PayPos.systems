-- ADD COLUMN وCREATE TRIGGER يأخذان قفلاً على service_lines وdiscount_proposals؛ المهلة القصيرة تفشل الهجرة سريعاً وتُعاد بدل أن تعلق.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "discount_proposal_performers" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"linked_user_id" uuid,
	"first_name_en" text NOT NULL,
	"first_name_ar" text,
	CONSTRAINT "dpp_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "dpp_proposal_employee_key" UNIQUE("company_id","proposal_id","employee_id"),
	CONSTRAINT "dpp_first_names_ck" CHECK (char_length("discount_proposal_performers"."first_name_en") BETWEEN 1 AND 255 AND char_length("discount_proposal_performers"."first_name_ar") <= 255)
);
--> statement-breakpoint
CREATE TABLE "discount_proposals" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"input_index" integer NOT NULL,
	"kind" text NOT NULL,
	"line_id" uuid,
	"base_revision" integer,
	"base_price" numeric(14,3),
	"base_discount" numeric(14,3),
	"base_net" numeric(14,3),
	"session_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name_en" text NOT NULL,
	"service_name_ar" text,
	"terms" jsonb NOT NULL,
	"terms_hash" char(64) NOT NULL,
	"effective_bps" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"requester_limit_source" text NOT NULL,
	"requester_limit_bps" integer,
	"requester_name_ar" text,
	"requester_name_en" text,
	"requester_role" text NOT NULL,
	"requester_role_is_system" boolean NOT NULL,
	"requester_role_name_ar" text,
	"requester_role_name_en" text NOT NULL,
	"requester_first_name_en" text,
	"requester_first_name_ar" text,
	"customer_first_name" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_by_membership_id" uuid,
	"decided_via" text,
	"decided_device_id" uuid,
	"decider_name_ar" text,
	"decider_name_en" text,
	"decider_role" text,
	"decider_role_is_system" boolean,
	"decider_role_name_ar" text,
	"decider_role_name_en" text,
	"decided_at" timestamp with time zone,
	"approved_limit_source" text,
	"approved_limit_bps" integer,
	"approver_is_performer" boolean,
	"reject_reason" text,
	"consumed_line_id" uuid,
	"consumed_edit_id" uuid,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "dp_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "dp_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "dp_consumed_line_key" UNIQUE("company_id","id","consumed_line_id"),
	CONSTRAINT "dp_consumed_edit_key" UNIQUE("company_id","id","consumed_edit_id"),
	CONSTRAINT "dp_request_input_key" UNIQUE("company_id","request_id","input_index"),
	CONSTRAINT "dp_status_ck" CHECK ("discount_proposals"."status" IN ('PENDING','APPROVED','REJECTED','CONSUMED')),
	CONSTRAINT "dp_kind_ck" CHECK (("discount_proposals"."kind" IN ('RECORD','EDIT')) IS TRUE),
	CONSTRAINT "dp_kind_shape_ck" CHECK (((("discount_proposals"."kind" = 'RECORD' AND "discount_proposals"."line_id" IS NULL AND "discount_proposals"."base_revision" IS NULL AND "discount_proposals"."base_price" IS NULL AND "discount_proposals"."base_discount" IS NULL AND "discount_proposals"."base_net" IS NULL AND "discount_proposals"."consumed_edit_id" IS NULL) OR ("discount_proposals"."kind" = 'EDIT' AND "discount_proposals"."line_id" IS NOT NULL AND "discount_proposals"."base_revision" IS NOT NULL AND "discount_proposals"."base_revision" >= 1 AND "discount_proposals"."base_price" IS NOT NULL AND "discount_proposals"."base_discount" IS NOT NULL AND "discount_proposals"."base_net" IS NOT NULL AND "discount_proposals"."session_id" IS NOT NULL AND "discount_proposals"."input_index" = 0 AND "discount_proposals"."consumed_line_id" IS NULL))) IS TRUE),
	CONSTRAINT "dp_base_amounts_ck" CHECK ((("discount_proposals"."base_price" IS NULL AND "discount_proposals"."base_discount" IS NULL AND "discount_proposals"."base_net" IS NULL) OR ("discount_proposals"."base_price" >= 0 AND "discount_proposals"."base_discount" >= 0 AND "discount_proposals"."base_discount" <= "discount_proposals"."base_price" AND "discount_proposals"."base_net" >= 0 AND "discount_proposals"."base_net" = "discount_proposals"."base_price" - "discount_proposals"."base_discount")) IS TRUE),
	CONSTRAINT "dp_input_index_ck" CHECK ("discount_proposals"."input_index" BETWEEN 0 AND 19),
	CONSTRAINT "dp_effective_bps_ck" CHECK ("discount_proposals"."effective_bps" BETWEEN 1 AND 10000),
	CONSTRAINT "dp_terms_hash_ck" CHECK ("discount_proposals"."terms_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dp_service_names_ck" CHECK (char_length(trim("discount_proposals"."service_name_en")) BETWEEN 1 AND 255 AND "discount_proposals"."service_name_en" !~ '[[:cntrl:]]' AND ("discount_proposals"."service_name_ar" IS NULL OR (char_length(trim("discount_proposals"."service_name_ar")) BETWEEN 1 AND 255 AND "discount_proposals"."service_name_ar" !~ '[[:cntrl:]]'))),
	CONSTRAINT "dp_requester_limit_ck" CHECK ((("discount_proposals"."requester_limit_source"='OWNER' AND "discount_proposals"."requester_limit_bps" IS NULL) OR ("discount_proposals"."requester_limit_source"='NOT_CONFIGURED' AND "discount_proposals"."requester_limit_bps"=0) OR ("discount_proposals"."requester_limit_source" IN ('PERSON','BUSINESS') AND "discount_proposals"."requester_limit_bps" BETWEEN 0 AND 10000)) IS TRUE),
	CONSTRAINT "dp_requester_names_ck" CHECK (("discount_proposals"."requester_name_ar" IS NULL OR "discount_proposals"."requester_name_en" IS NOT NULL) AND ("discount_proposals"."requester_role_name_ar" IS NULL OR "discount_proposals"."requester_role_name_en" IS NOT NULL) AND "discount_proposals"."requester_role" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "dp_requester_lengths_ck" CHECK (char_length("discount_proposals"."requester_name_ar") <= 255 AND char_length("discount_proposals"."requester_name_en") <= 255 AND char_length("discount_proposals"."requester_role_name_ar") <= 255 AND char_length("discount_proposals"."requester_role_name_en") <= 255 AND char_length("discount_proposals"."requester_first_name_en") <= 255 AND char_length("discount_proposals"."requester_first_name_ar") <= 255),
	CONSTRAINT "dp_requester_first_names_ck" CHECK (("discount_proposals"."requester_first_name_en" IS NULL) = ("discount_proposals"."requester_name_en" IS NULL) AND ("discount_proposals"."requester_first_name_ar" IS NULL) = ("discount_proposals"."requester_name_ar" IS NULL)),
	CONSTRAINT "dp_customer_first_name_ck" CHECK (char_length("discount_proposals"."customer_first_name") BETWEEN 1 AND 200),
	CONSTRAINT "dp_decision_ck" CHECK (("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decided_by" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decided_by_membership_id" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decided_via" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decided_at" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decider_role" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decider_role_is_system" IS NULL) AND ("discount_proposals"."status" = 'PENDING') = ("discount_proposals"."decider_role_name_en" IS NULL)),
	CONSTRAINT "dp_decider_names_ck" CHECK (("discount_proposals"."status" <> 'PENDING' OR ("discount_proposals"."decider_name_en" IS NULL AND "discount_proposals"."decider_name_ar" IS NULL AND "discount_proposals"."decider_role_name_ar" IS NULL)) AND ("discount_proposals"."decider_name_ar" IS NULL OR "discount_proposals"."decider_name_en" IS NOT NULL) AND ("discount_proposals"."decider_role_name_ar" IS NULL OR "discount_proposals"."decider_role_name_en" IS NOT NULL) AND "discount_proposals"."decider_role" ~ '^[a-z][a-z_]{0,63}$'),
	CONSTRAINT "dp_decider_lengths_ck" CHECK (char_length("discount_proposals"."decider_name_ar") <= 255 AND char_length("discount_proposals"."decider_name_en") <= 255 AND char_length("discount_proposals"."decider_role_name_ar") <= 255 AND char_length("discount_proposals"."decider_role_name_en") <= 255),
	CONSTRAINT "dp_decided_via_ck" CHECK ("discount_proposals"."decided_via" IN ('PIN','REMOTE') AND ("discount_proposals"."decided_device_id" IS NOT NULL) = coalesce("discount_proposals"."decided_via" = 'PIN', false)),
	CONSTRAINT "dp_approved_limit_ck" CHECK (((("discount_proposals"."status" IN ('APPROVED','CONSUMED')) = ("discount_proposals"."approved_limit_source" IS NOT NULL)) AND (("discount_proposals"."approved_limit_source" IS NULL AND "discount_proposals"."approved_limit_bps" IS NULL) OR ("discount_proposals"."approved_limit_source"='OWNER' AND "discount_proposals"."approved_limit_bps" IS NULL) OR ("discount_proposals"."approved_limit_source"='NOT_CONFIGURED' AND "discount_proposals"."approved_limit_bps"=0) OR ("discount_proposals"."approved_limit_source" IN ('PERSON','BUSINESS') AND "discount_proposals"."approved_limit_bps" BETWEEN 0 AND 10000))) IS TRUE),
	CONSTRAINT "dp_reject_reason_ck" CHECK ("discount_proposals"."reject_reason" IS NULL OR ("discount_proposals"."status" = 'REJECTED' AND "discount_proposals"."reject_reason" = btrim("discount_proposals"."reject_reason", chr(9) || chr(10) || chr(13) || chr(32)) AND char_length("discount_proposals"."reject_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "dp_approver_flag_ck" CHECK (((("discount_proposals"."status" IN ('APPROVED','CONSUMED')) = ("discount_proposals"."approver_is_performer" IS NOT NULL)) IS TRUE)),
	CONSTRAINT "dp_consumption_ck" CHECK (((("discount_proposals"."status" = 'CONSUMED') = ("discount_proposals"."consumed_at" IS NOT NULL)) AND (("discount_proposals"."status" <> 'CONSUMED' AND "discount_proposals"."consumed_line_id" IS NULL AND "discount_proposals"."consumed_edit_id" IS NULL) OR ("discount_proposals"."status" = 'CONSUMED' AND "discount_proposals"."kind" = 'RECORD' AND "discount_proposals"."consumed_line_id" IS NOT NULL AND "discount_proposals"."consumed_edit_id" IS NULL) OR ("discount_proposals"."status" = 'CONSUMED' AND "discount_proposals"."kind" = 'EDIT' AND "discount_proposals"."consumed_edit_id" IS NOT NULL AND "discount_proposals"."consumed_line_id" IS NULL))) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "service_lines" ADD COLUMN "discount_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "discount_proposal_performers" ADD CONSTRAINT "discount_proposal_performers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposal_performers" ADD CONSTRAINT "discount_proposal_performers_linked_user_id_user_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposal_performers" ADD CONSTRAINT "dpp_proposal_fk" FOREIGN KEY ("company_id","business_id","proposal_id") REFERENCES "public"."discount_proposals"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposal_performers" ADD CONSTRAINT "dpp_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "discount_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_service_fk" FOREIGN KEY ("company_id","business_id","service_id") REFERENCES "public"."services"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_requester_membership_fk" FOREIGN KEY ("company_id","requested_by","requested_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_proposals" ADD CONSTRAINT "dp_decider_membership_fk" FOREIGN KEY ("company_id","decided_by","decided_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dpp_proposal_fk_idx" ON "discount_proposal_performers" USING btree ("company_id","business_id","proposal_id");--> statement-breakpoint
CREATE INDEX "dpp_employee_fk_idx" ON "discount_proposal_performers" USING btree ("company_id","business_id","employee_id");--> statement-breakpoint
CREATE INDEX "dpp_linked_user_idx" ON "discount_proposal_performers" USING btree ("linked_user_id") WHERE "discount_proposal_performers"."linked_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dp_consumed_line_uq" ON "discount_proposals" USING btree ("company_id","consumed_line_id") WHERE "discount_proposals"."consumed_line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dp_consumed_edit_uq" ON "discount_proposals" USING btree ("company_id","consumed_edit_id") WHERE "discount_proposals"."consumed_edit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dp_branch_status_idx" ON "discount_proposals" USING btree ("company_id","branch_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "dp_pending_idx" ON "discount_proposals" USING btree ("company_id","branch_id","requested_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "discount_proposals"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "dp_requested_by_idx" ON "discount_proposals" USING btree ("company_id","requested_by","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dp_branch_fk_idx" ON "discount_proposals" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "dp_session_fk_idx" ON "discount_proposals" USING btree ("company_id","business_id","session_id") WHERE "discount_proposals"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dp_line_fk_idx" ON "discount_proposals" USING btree ("company_id","business_id","line_id") WHERE "discount_proposals"."line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dp_consumed_edit_fk_idx" ON "discount_proposals" USING btree ("company_id","line_id","consumed_edit_id") WHERE "discount_proposals"."consumed_edit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dp_customer_fk_idx" ON "discount_proposals" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "dp_service_fk_idx" ON "discount_proposals" USING btree ("company_id","business_id","service_id");--> statement-breakpoint
CREATE INDEX "dp_requester_membership_idx" ON "discount_proposals" USING btree ("company_id","requested_by","requested_by_membership_id");--> statement-breakpoint
CREATE INDEX "dp_decider_membership_idx" ON "discount_proposals" USING btree ("company_id","decided_by","decided_by_membership_id") WHERE "discount_proposals"."decided_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dp_device_fk_idx" ON "discount_proposals" USING btree ("company_id","branch_id","decided_device_id") WHERE "discount_proposals"."decided_device_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE discount_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discount_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY discount_proposals_select ON discount_proposals FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY discount_proposals_insert ON discount_proposals FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY discount_proposals_update ON discount_proposals FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE discount_proposal_performers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE discount_proposal_performers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY discount_proposal_performers_select ON discount_proposal_performers FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY discount_proposal_performers_insert ON discount_proposal_performers FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON discount_proposals, discount_proposal_performers FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON discount_proposals, discount_proposal_performers TO pospay_app;
--> statement-breakpoint
-- أعمدة القرار والاستهلاك وحدها قابلة للتحديث؛ الشروط والطلب واللقطات تثبت بالمنح وبالتريغر معاً.
GRANT UPDATE (status, expires_at, decided_by, decided_by_membership_id, decided_via, decided_device_id,
  decider_name_ar, decider_name_en, decider_role, decider_role_is_system, decider_role_name_ar, decider_role_name_en,
  decided_at, approved_limit_source, approved_limit_bps, approver_is_performer, reject_reason, consumed_line_id,
  consumed_edit_id, consumed_at)
  ON discount_proposals TO pospay_app;
--> statement-breakpoint
-- المسارات الثلاثة فقط؛ الطلب يولد PENDING حتى لا يُدخل كاتب موافقة جاهزة تتخطى القرار.
CREATE FUNCTION discount_proposals_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'a discount proposal is requested PENDING' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF NEW.status = 'REJECTED' AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'rejecting a discount proposal keeps expires_at' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    IF (to_jsonb(OLD) - ARRAY['status', 'expires_at', 'decided_by', 'decided_by_membership_id', 'decided_via',
        'decided_device_id', 'decider_name_ar', 'decider_name_en', 'decider_role', 'decider_role_is_system',
        'decider_role_name_ar', 'decider_role_name_en', 'decided_at', 'approved_limit_source', 'approved_limit_bps',
        'approver_is_performer', 'reject_reason']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'expires_at', 'decided_by',
        'decided_by_membership_id', 'decided_via', 'decided_device_id', 'decider_name_ar', 'decider_name_en',
        'decider_role', 'decider_role_is_system', 'decider_role_name_ar', 'decider_role_name_en', 'decided_at',
        'approved_limit_source', 'approved_limit_bps', 'approver_is_performer', 'reject_reason']) THEN
      RAISE EXCEPTION 'deciding a discount proposal changes only the decision columns' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'CONSUMED' THEN
    IF (to_jsonb(OLD) - ARRAY['status', 'consumed_line_id', 'consumed_edit_id', 'consumed_at'])
        IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'consumed_line_id', 'consumed_edit_id', 'consumed_at']) THEN
      RAISE EXCEPTION 'consuming a discount proposal changes only status, consumed_line_id, consumed_edit_id and consumed_at' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a discount proposal moves only PENDING to APPROVED or REJECTED, or APPROVED to CONSUMED' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION discount_proposals_transition_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION discount_proposals_transition_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER discount_proposals_transition_guard BEFORE INSERT OR UPDATE ON discount_proposals
FOR EACH ROW EXECUTE FUNCTION discount_proposals_transition_guard();
--> statement-breakpoint
-- قرار المالك DA-Q1 بتاريخ 2026-10-21: الموافقة على الخصم للمديرين الأربعة افتراضياً، وتفويضها لأي دور بشري.
INSERT INTO permissions(code) VALUES ('approve:discounts:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code)
SELECT r.id, 'global', NULL, 'approve:discounts:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner', 'general_manager', 'business_manager', 'branch_manager')
ON CONFLICT DO NOTHING;
