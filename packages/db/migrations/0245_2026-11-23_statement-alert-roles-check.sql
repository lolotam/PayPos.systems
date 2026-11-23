-- pospay:data-step statement-alert-roles
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_statement_roles" CHECK ("alert_rules"."kind" NOT IN ('STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL') OR NOT ('branch_manager' = ANY("alert_rules"."recipient_roles"))) NOT VALID;
--> statement-breakpoint
ALTER TABLE "alert_rules" VALIDATE CONSTRAINT "alert_rules_statement_roles";
