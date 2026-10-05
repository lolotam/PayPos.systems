CREATE TABLE "employee_cards" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"card_code_hash" text NOT NULL,
	"card_code_suffix" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "employee_cards_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "employee_cards_code_hash" CHECK ("employee_cards"."card_code_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "employee_cards_code_suffix" CHECK (char_length("employee_cards"."card_code_suffix") BETWEEN 0 AND 4 AND "employee_cards"."card_code_suffix" ~ '^[!-~]*$'),
	CONSTRAINT "employee_cards_revoked_pair" CHECK (("employee_cards"."revoked_at" IS NULL) = ("employee_cards"."revoked_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "employee_cards" ADD CONSTRAINT "employee_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cards" ADD CONSTRAINT "employee_cards_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cards" ADD CONSTRAINT "employee_cards_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_cards" ADD CONSTRAINT "employee_cards_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_cards_active_employee_key" ON "employee_cards" USING btree ("company_id","employee_id") WHERE "employee_cards"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_cards_active_code_key" ON "employee_cards" USING btree ("company_id","card_code_hash") WHERE "employee_cards"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "employee_cards_employee_history_idx" ON "employee_cards" USING btree ("company_id","employee_id","issued_at");--> statement-breakpoint
CREATE INDEX "employee_cards_business_idx" ON "employee_cards" USING btree ("company_id","business_id");--> statement-breakpoint
CREATE INDEX "employee_cards_issued_by_idx" ON "employee_cards" USING btree ("issued_by");--> statement-breakpoint
CREATE INDEX "employee_cards_revoked_by_idx" ON "employee_cards" USING btree ("revoked_by");