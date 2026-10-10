CREATE TABLE "attendance_change_requests" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"session_id" uuid,
	"session_revision" integer,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attendance_change_requests_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_change_requests_kind" CHECK ("attendance_change_requests"."kind" IN ('ADD_SESSION','VOID_SESSION')),
	CONSTRAINT "attendance_change_requests_status" CHECK ("attendance_change_requests"."status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
	CONSTRAINT "attendance_change_requests_revision" CHECK ("attendance_change_requests"."revision" >= 0),
	CONSTRAINT "attendance_change_requests_session_revision" CHECK ("attendance_change_requests"."session_revision" IS NULL OR "attendance_change_requests"."session_revision" >= 0),
	CONSTRAINT "attendance_change_requests_reason" CHECK ("attendance_change_requests"."reason" = btrim("attendance_change_requests"."reason") AND char_length("attendance_change_requests"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "attendance_change_requests_decision_reason" CHECK ("attendance_change_requests"."decision_reason" IS NULL OR ("attendance_change_requests"."decision_reason" = btrim("attendance_change_requests"."decision_reason") AND char_length("attendance_change_requests"."decision_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "attendance_change_requests_pending" CHECK ("attendance_change_requests"."status" <> 'PENDING' OR ("attendance_change_requests"."decided_by" IS NULL AND "attendance_change_requests"."decided_at" IS NULL AND "attendance_change_requests"."decision_reason" IS NULL AND "attendance_change_requests"."cancelled_by" IS NULL AND "attendance_change_requests"."cancelled_at" IS NULL)),
	CONSTRAINT "attendance_change_requests_approved" CHECK ("attendance_change_requests"."status" <> 'APPROVED' OR ("attendance_change_requests"."decided_by" IS NOT NULL AND "attendance_change_requests"."decided_at" IS NOT NULL AND "attendance_change_requests"."cancelled_by" IS NULL AND "attendance_change_requests"."cancelled_at" IS NULL)),
	CONSTRAINT "attendance_change_requests_rejected" CHECK ("attendance_change_requests"."status" <> 'REJECTED' OR ("attendance_change_requests"."decided_by" IS NOT NULL AND "attendance_change_requests"."decided_at" IS NOT NULL AND "attendance_change_requests"."decision_reason" IS NOT NULL AND "attendance_change_requests"."cancelled_by" IS NULL AND "attendance_change_requests"."cancelled_at" IS NULL)),
	CONSTRAINT "attendance_change_requests_cancelled" CHECK ("attendance_change_requests"."status" <> 'CANCELLED' OR ("attendance_change_requests"."cancelled_by" IS NOT NULL AND "attendance_change_requests"."cancelled_at" IS NOT NULL AND "attendance_change_requests"."decided_by" IS NULL AND "attendance_change_requests"."decided_at" IS NULL AND "attendance_change_requests"."decision_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_change_requests" ADD CONSTRAINT "attendance_change_requests_session_fk" FOREIGN KEY ("company_id","session_id") REFERENCES "public"."attendance_sessions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_change_requests_inbox_idx" ON "attendance_change_requests" USING btree ("company_id","business_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_branch_idx" ON "attendance_change_requests" USING btree ("company_id","business_id","branch_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_employee_idx" ON "attendance_change_requests" USING btree ("company_id","employee_id","requested_at");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_session_idx" ON "attendance_change_requests" USING btree ("company_id","session_id");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_requester_idx" ON "attendance_change_requests" USING btree ("company_id","requested_by");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_decider_idx" ON "attendance_change_requests" USING btree ("company_id","decided_by");--> statement-breakpoint
CREATE INDEX "attendance_change_requests_canceller_idx" ON "attendance_change_requests" USING btree ("company_id","cancelled_by");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_change_requests_one_pending_void" ON "attendance_change_requests" USING btree ("company_id","session_id") WHERE "attendance_change_requests"."status" = 'PENDING' AND "attendance_change_requests"."kind" = 'VOID_SESSION';