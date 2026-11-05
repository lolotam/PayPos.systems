CREATE UNIQUE INDEX CONCURRENTLY package_redemptions_live_slot_key ON public.package_redemptions(company_id,slot_id) WHERE reversed_at IS NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_component_fk_idx ON public.package_redemptions(company_id,business_id,entitlement_id,component_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_slot_fk_idx ON public.package_redemptions(company_id,business_id,slot_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_line_fk_idx ON public.package_redemptions(company_id,business_id,line_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_actor_fk_idx ON public.package_redemptions(recorded_by);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_membership_fk_idx ON public.package_redemptions(company_id,recorded_by,recorded_by_membership_id);
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_redemptions_cancellation_fk_idx ON public.package_redemptions(company_id,reversal_cancellation_id) WHERE reversal_cancellation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY service_lines_redemption_fk_idx ON public.service_lines(company_id,business_id,redemption_id) WHERE redemption_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY package_session_slots_redemption_fk_idx ON public.package_session_slots(company_id,business_id,current_redemption_id) WHERE current_redemption_id IS NOT NULL;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE public.service_lines VALIDATE CONSTRAINT service_lines_redemption_fk;
--> statement-breakpoint
ALTER TABLE public.package_session_slots VALIDATE CONSTRAINT package_session_slots_redemption_fk;
