-- 47-2b contract B (0216): concurrent FK index, then validation; requires 0215.
-- Concurrent prefix must precede every transactional statement (ADR-0033).
CREATE INDEX CONCURRENTLY import_previews_commit_membership_idx ON public.import_previews(company_id,created_by,commit_membership_id);
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE public.import_previews VALIDATE CONSTRAINT import_previews_commit_membership_fk;
