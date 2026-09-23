ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "user_phone_number_key" ON "user" USING btree ("phone_number");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_e164" CHECK ("user"."phone_number" IS NULL OR "user"."phone_number" ~ '^[+][1-9][0-9]{6,14}$');