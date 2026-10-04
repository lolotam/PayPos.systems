CREATE TABLE "leave_requests" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"start" text,
	"end" text,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_requests_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "leave_requests_type" CHECK ("leave_requests"."type" IN ('ANNUAL','SICK','UNPAID','OTHER')),
	CONSTRAINT "leave_requests_note" CHECK (("leave_requests"."note" IS NULL OR (char_length("leave_requests"."note") BETWEEN 1 AND 500 AND "leave_requests"."note"=btrim("leave_requests"."note"))) AND ("leave_requests"."type"<>'OTHER' OR "leave_requests"."note" IS NOT NULL)),
	CONSTRAINT "leave_requests_period" CHECK ("leave_requests"."from"<="leave_requests"."to" AND "leave_requests"."starts_at"<"leave_requests"."ends_at"),
	CONSTRAINT "leave_requests_kind" CHECK (("leave_requests"."kind"='FULL_DAY' AND "leave_requests"."start" IS NULL AND "leave_requests"."end" IS NULL) OR ("leave_requests"."kind"='PARTIAL' AND "leave_requests"."from"="leave_requests"."to" AND "leave_requests"."start" IS NOT NULL AND "leave_requests"."end" IS NOT NULL AND "leave_requests"."start" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND "leave_requests"."end" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND "leave_requests"."start"<"leave_requests"."end")),
	CONSTRAINT "leave_requests_revision" CHECK ("leave_requests"."revision">0),
	CONSTRAINT "leave_requests_status" CHECK (("leave_requests"."status"='PENDING' AND "leave_requests"."cancelled_by" IS NULL AND "leave_requests"."cancelled_at" IS NULL AND "leave_requests"."decided_by" IS NULL AND "leave_requests"."decided_at" IS NULL AND "leave_requests"."rejection_reason" IS NULL) OR ("leave_requests"."status"='CANCELLED' AND "leave_requests"."cancelled_by" IS NOT NULL AND "leave_requests"."cancelled_at" IS NOT NULL AND "leave_requests"."decided_by" IS NULL AND "leave_requests"."decided_at" IS NULL AND "leave_requests"."rejection_reason" IS NULL) OR ("leave_requests"."status" IN ('APPROVED','REJECTED') AND "leave_requests"."decided_by" IS NOT NULL AND "leave_requests"."decided_at" IS NOT NULL AND "leave_requests"."cancelled_by" IS NULL AND "leave_requests"."cancelled_at" IS NULL AND (("leave_requests"."status"='APPROVED' AND "leave_requests"."rejection_reason" IS NULL) OR ("leave_requests"."status"='REJECTED' AND "leave_requests"."rejection_reason" IS NOT NULL AND char_length(btrim("leave_requests"."rejection_reason")) BETWEEN 1 AND 500))))
);
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_code_format";--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_company_employee_period_idx" ON "leave_requests" USING btree ("company_id","employee_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "leave_requests_company_employee_id_idx" ON "leave_requests" USING btree ("company_id","employee_id","id");--> statement-breakpoint
CREATE INDEX "leave_requests_company_business_branch_status_id_idx" ON "leave_requests" USING btree ("company_id","business_id","branch_id","status","id");--> statement-breakpoint
CREATE INDEX "leave_requests_company_business_id_idx" ON "leave_requests" USING btree ("company_id","business_id","id");--> statement-breakpoint
CREATE INDEX "leave_requests_company_branch_idx" ON "leave_requests" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "leave_requests_requested_by_idx" ON "leave_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "leave_requests_cancelled_by_idx" ON "leave_requests" USING btree ("cancelled_by");--> statement-breakpoint
CREATE INDEX "leave_requests_decided_by_idx" ON "leave_requests" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_code_format" CHECK ("permissions"."code" ~ '^[a-z][a-z-]*:[a-z][a-z-]*:(platform|company|business|branch|own)$');