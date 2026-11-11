CREATE TABLE "package_sale_requests" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_by_membership_id" uuid NOT NULL,
	"discount_limit_bps" integer,
	"customer_id" uuid NOT NULL,
	"package_type_id" uuid NOT NULL,
	"expected_type_revision" integer NOT NULL,
	"expected_service_revisions" jsonb NOT NULL,
	"price_paid" numeric(14, 3) NOT NULL,
	"paid_method" text NOT NULL,
	"seller_employee_id" uuid NOT NULL,
	"sold_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entitlement_id" uuid,
	"error_code" text,
	"error_details" jsonb,
	"finished_at" timestamp with time zone,
	CONSTRAINT "package_sale_requests_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "package_sale_requests_status_check" CHECK ("package_sale_requests"."status" IN ('pending', 'completed', 'failed')),
	CONSTRAINT "package_sale_requests_paid_method_check" CHECK ("package_sale_requests"."paid_method" IN ('CASH', 'CARD')),
	CONSTRAINT "package_sale_requests_discount_limit_bps_check" CHECK ("package_sale_requests"."discount_limit_bps" IS NULL OR "package_sale_requests"."discount_limit_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "package_sale_requests_expected_service_revisions_check" CHECK (CASE WHEN jsonb_typeof("package_sale_requests"."expected_service_revisions") = 'array' THEN jsonb_array_length("package_sale_requests"."expected_service_revisions") BETWEEN 1 AND 20 AND NOT jsonb_path_exists("package_sale_requests"."expected_service_revisions", '$[*] ? (@.type() != "object" || !exists(@.service_id) || @.service_id.type() != "string" || !exists(@.revision) || @.revision.type() != "number" || @.revision.floor() != @.revision || !exists(@.list_price) || @.list_price.type() != "string")') ELSE false END),
	CONSTRAINT "package_sale_requests_error_details_size_check" CHECK ("package_sale_requests"."error_details" IS NULL OR octet_length("package_sale_requests"."error_details"::text) <= 8192),
	CONSTRAINT "package_sale_requests_state_shape_check" CHECK (("package_sale_requests"."status" = 'pending' AND "package_sale_requests"."entitlement_id" IS NULL AND "package_sale_requests"."error_code" IS NULL AND "package_sale_requests"."error_details" IS NULL AND "package_sale_requests"."finished_at" IS NULL)
      OR ("package_sale_requests"."status" = 'completed' AND "package_sale_requests"."entitlement_id" IS NOT NULL AND "package_sale_requests"."finished_at" IS NOT NULL AND "package_sale_requests"."error_code" IS NULL AND "package_sale_requests"."error_details" IS NULL)
      OR ("package_sale_requests"."status" = 'failed' AND "package_sale_requests"."error_code" IS NOT NULL AND "package_sale_requests"."finished_at" IS NOT NULL AND "package_sale_requests"."entitlement_id" IS NULL)),
	CONSTRAINT "package_sale_requests_price_paid_check" CHECK ("package_sale_requests"."price_paid" BETWEEN 0 AND 99999999999.999)
);
--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_business_fk" FOREIGN KEY ("company_id","business_id") REFERENCES "public"."businesses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_recorder_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_recorder_membership_fk" FOREIGN KEY ("company_id","recorded_by","recorded_by_membership_id") REFERENCES "public"."memberships"("company_id","user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_sale_requests" ADD CONSTRAINT "package_sale_requests_entitlement_fk" FOREIGN KEY ("company_id","business_id","entitlement_id") REFERENCES "public"."package_entitlements"("company_id","business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_sale_requests_business_fk_idx" ON "package_sale_requests" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "package_sale_requests_branch_fk_idx" ON "package_sale_requests" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "package_sale_requests_recorder_fk_idx" ON "package_sale_requests" USING btree ("recorded_by");--> statement-breakpoint
CREATE INDEX "package_sale_requests_recorder_membership_fk_idx" ON "package_sale_requests" USING btree ("company_id","recorded_by","recorded_by_membership_id");--> statement-breakpoint
CREATE INDEX "package_sale_requests_entitlement_fk_idx" ON "package_sale_requests" USING btree ("company_id","business_id","entitlement_id") WHERE "package_sale_requests"."entitlement_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "package_sale_requests_creator_status_idx" ON "package_sale_requests" USING btree ("company_id","recorded_by","id");--> statement-breakpoint
CREATE INDEX "package_sale_requests_recovery_sweep_idx" ON "package_sale_requests" USING btree ("company_id","status","recorded_at");
--> statement-breakpoint
ALTER TABLE "package_sale_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "package_sale_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "package_sale_requests_select" ON "package_sale_requests" FOR SELECT TO pospay_app USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "package_sale_requests_insert" ON "package_sale_requests" FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY "package_sale_requests_update" ON "package_sale_requests" FOR UPDATE TO pospay_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION package_sale_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'PACKAGE_SALE_REQUEST_INITIAL_STATUS_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'entitlement_id', 'error_code', 'error_details', 'finished_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'entitlement_id', 'error_code', 'error_details', 'finished_at']) THEN
      RAISE EXCEPTION 'PACKAGE_SALE_REQUEST_BODY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION package_sale_request_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION package_sale_request_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER package_sale_request_guard
BEFORE INSERT OR UPDATE ON package_sale_requests
FOR EACH ROW EXECUTE FUNCTION package_sale_request_guard();
--> statement-breakpoint
REVOKE ALL ON package_sale_requests FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON package_sale_requests TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (status, entitlement_id, error_code, error_details, finished_at) ON package_sale_requests TO pospay_app;
