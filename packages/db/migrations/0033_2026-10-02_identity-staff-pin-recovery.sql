ALTER TABLE "cashier_pins" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_user" UNIQUE("company_id","user_id");--> statement-breakpoint
ALTER TABLE "cashier_pins" ADD CONSTRAINT "cashier_pins_one_holder" CHECK (num_nonnulls("cashier_pins"."employee_id", "cashier_pins"."user_id") = 1);