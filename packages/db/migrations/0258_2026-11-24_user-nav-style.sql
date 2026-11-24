ALTER TABLE "user" ADD COLUMN "nav_style" text;
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_nav_style" CHECK ("user"."nav_style" IN ('A', 'B', 'C')) NOT VALID;
