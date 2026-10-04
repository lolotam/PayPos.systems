CREATE TABLE "attendance_clock_challenges" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"binding_revision" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"scan_digest" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_clock_challenges_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_clock_challenges_operation" CHECK ("attendance_clock_challenges"."operation" IN ('CLOCK_IN','CLOCK_OUT')),
	CONSTRAINT "attendance_clock_challenges_revision" CHECK ("attendance_clock_challenges"."binding_revision" > 0),
	CONSTRAINT "attendance_clock_challenges_digest" CHECK ("attendance_clock_challenges"."scan_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "attendance_exceptions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" uuid,
	"reason" text,
	CONSTRAINT "attendance_exceptions_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_exceptions_kind" CHECK ("attendance_exceptions"."kind" IN ('NONE','OUT_OF_RANGE','SUSPECTED_MISSED_OUT')),
	CONSTRAINT "attendance_exceptions_status" CHECK ("attendance_exceptions"."status" IN ('OPEN','RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"working_date" date NOT NULL,
	"timezone" text NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"closed_by" text,
	"binding_id" uuid,
	"binding_revision" integer,
	"out_binding_id" uuid,
	"out_binding_revision" integer,
	"qr_window" integer,
	"out_qr_window" integer,
	"geo" text NOT NULL,
	"out_geo" text,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy" double precision,
	"out_latitude" double precision,
	"out_longitude" double precision,
	"out_accuracy" double precision,
	"late_minutes" integer NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"device_id" uuid,
	"operator_id" uuid,
	"out_device_id" uuid,
	"out_operator_id" uuid,
	CONSTRAINT "attendance_sessions_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_sessions_status" CHECK ("attendance_sessions"."status" IN ('OPEN','CLOSED','MISSED_OUT')),
	CONSTRAINT "attendance_sessions_source" CHECK ("attendance_sessions"."source" IN ('QR','BARCODE')),
	CONSTRAINT "attendance_sessions_close_pair" CHECK (("attendance_sessions"."status" = 'OPEN' AND "attendance_sessions"."clock_out" IS NULL AND "attendance_sessions"."closed_by" IS NULL) OR ("attendance_sessions"."status" <> 'OPEN' AND "attendance_sessions"."clock_out" >= "attendance_sessions"."clock_in" AND "attendance_sessions"."closed_by" IN ('EMPLOYEE','MISSED_OUT'))),
	CONSTRAINT "attendance_sessions_lateness" CHECK ("attendance_sessions"."late_minutes" >= 0),
	CONSTRAINT "attendance_sessions_geo" CHECK ("attendance_sessions"."geo" IN ('OK','NONE','OUT_OF_RANGE') AND ("attendance_sessions"."out_geo" IS NULL OR "attendance_sessions"."out_geo" IN ('OK','NONE','OUT_OF_RANGE'))),
	CONSTRAINT "attendance_sessions_binding_pair" CHECK (("attendance_sessions"."binding_id" IS NULL) = ("attendance_sessions"."binding_revision" IS NULL) AND ("attendance_sessions"."binding_revision" IS NULL OR "attendance_sessions"."binding_revision">0)),
	CONSTRAINT "attendance_sessions_out_binding_pair" CHECK (("attendance_sessions"."out_binding_id" IS NULL) = ("attendance_sessions"."out_binding_revision" IS NULL) AND ("attendance_sessions"."out_binding_revision" IS NULL OR "attendance_sessions"."out_binding_revision">0)),
	CONSTRAINT "attendance_sessions_location" CHECK (("attendance_sessions"."latitude" IS NULL AND "attendance_sessions"."longitude" IS NULL AND "attendance_sessions"."accuracy" IS NULL) OR ("attendance_sessions"."latitude" BETWEEN -90 AND 90 AND "attendance_sessions"."longitude" BETWEEN -180 AND 180 AND "attendance_sessions"."accuracy" >= 0)),
	CONSTRAINT "attendance_sessions_out_location" CHECK (("attendance_sessions"."out_latitude" IS NULL AND "attendance_sessions"."out_longitude" IS NULL AND "attendance_sessions"."out_accuracy" IS NULL) OR ("attendance_sessions"."out_latitude" BETWEEN -90 AND 90 AND "attendance_sessions"."out_longitude" BETWEEN -180 AND 180 AND "attendance_sessions"."out_accuracy" >= 0))
);
--> statement-breakpoint
CREATE TABLE "attendance_states" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"last_accepted_scan_at" timestamp with time zone,
	"last_result" jsonb,
	CONSTRAINT "attendance_states_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "attendance_states_employee_id" CHECK ("attendance_states"."id" = "attendance_states"."employee_id"),
	CONSTRAINT "attendance_states_result_pair" CHECK (("attendance_states"."last_accepted_scan_at" IS NULL) = ("attendance_states"."last_result" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_clock_challenges" ADD CONSTRAINT "attendance_clock_challenges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_clock_challenges" ADD CONSTRAINT "attendance_clock_challenges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_clock_challenges" ADD CONSTRAINT "attendance_clock_challenges_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_clock_challenges" ADD CONSTRAINT "attendance_clock_challenges_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_clock_challenges" ADD CONSTRAINT "attendance_clock_challenges_company_id_binding_id_employee_passkeys_company_id_id_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."employee_passkeys"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_company_id_session_id_attendance_sessions_company_id_id_fk" FOREIGN KEY ("company_id","session_id") REFERENCES "public"."attendance_sessions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exceptions" ADD CONSTRAINT "attendance_exceptions_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_operator_id_user_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_out_operator_id_user_id_fk" FOREIGN KEY ("out_operator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_business_id_branch_id_branches_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_binding_id_employee_passkeys_company_id_id_fk" FOREIGN KEY ("company_id","binding_id") REFERENCES "public"."employee_passkeys"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_out_binding_id_employee_passkeys_company_id_id_fk" FOREIGN KEY ("company_id","out_binding_id") REFERENCES "public"."employee_passkeys"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_device_id_devices_company_id_id_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_company_id_out_device_id_devices_company_id_id_fk" FOREIGN KEY ("company_id","out_device_id") REFERENCES "public"."devices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_states" ADD CONSTRAINT "attendance_states_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_states" ADD CONSTRAINT "attendance_states_company_id_business_id_employee_id_employees_company_id_business_id_id_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_clock_challenges_employee_idx" ON "attendance_clock_challenges" USING btree ("company_id","employee_id","issued_at");--> statement-breakpoint
CREATE INDEX "attendance_clock_challenges_branch_idx" ON "attendance_clock_challenges" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "attendance_clock_challenges_binding_idx" ON "attendance_clock_challenges" USING btree ("company_id","binding_id");--> statement-breakpoint
CREATE INDEX "attendance_clock_challenges_business_idx" ON "attendance_clock_challenges" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "attendance_clock_challenges_user_idx" ON "attendance_clock_challenges" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "attendance_exceptions_session_idx" ON "attendance_exceptions" USING btree ("company_id","session_id");--> statement-breakpoint
CREATE INDEX "attendance_exceptions_board_idx" ON "attendance_exceptions" USING btree ("company_id","business_id","branch_id","status","raised_at");--> statement-breakpoint
CREATE INDEX "attendance_exceptions_employee_idx" ON "attendance_exceptions" USING btree ("company_id","employee_id","raised_at");--> statement-breakpoint
CREATE INDEX "attendance_exceptions_actor_idx" ON "attendance_exceptions" USING btree ("company_id","resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_one_open" ON "attendance_sessions" USING btree ("company_id","employee_id") WHERE "attendance_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "attendance_sessions_board_idx" ON "attendance_sessions" USING btree ("company_id","business_id","branch_id","working_date","status");--> statement-breakpoint
CREATE INDEX "attendance_sessions_employee_date_idx" ON "attendance_sessions" USING btree ("company_id","employee_id","working_date","clock_in");--> statement-breakpoint
CREATE INDEX "attendance_sessions_business_date_idx" ON "attendance_sessions" USING btree ("company_id","business_id","working_date");--> statement-breakpoint
CREATE INDEX "attendance_sessions_binding_idx" ON "attendance_sessions" USING btree ("company_id","binding_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_out_binding_idx" ON "attendance_sessions" USING btree ("company_id","out_binding_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_device_idx" ON "attendance_sessions" USING btree ("company_id","device_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_out_device_idx" ON "attendance_sessions" USING btree ("company_id","out_device_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_operator_idx" ON "attendance_sessions" USING btree ("company_id","operator_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_out_operator_idx" ON "attendance_sessions" USING btree ("company_id","out_operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_states_employee_key" ON "attendance_states" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_states_business_idx" ON "attendance_states" USING btree ("company_id","business_id");