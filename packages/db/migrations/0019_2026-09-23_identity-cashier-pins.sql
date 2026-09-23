CREATE TABLE "cashier_pins" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashier_pins_pkey" PRIMARY KEY("company_id","id"),
	CONSTRAINT "cashier_pins_employee" UNIQUE("company_id","employee_id"),
	CONSTRAINT "cashier_pins_hash_format" CHECK ("cashier_pins"."pin_hash" LIKE 'pbkdf2-sha256$%')
);
--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cashier_pins_set_by_idx" ON "cashier_pins" USING btree ("set_by");