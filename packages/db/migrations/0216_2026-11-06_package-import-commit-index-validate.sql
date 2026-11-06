-- 0216: concurrent supporting indexes, equivalent service FK order and separate validation.
-- Concurrent prefix must precede every transactional statement (ADR-0033).
CREATE INDEX CONCURRENTLY import_previews_commit_membership_idx ON public.import_previews(company_id,created_by,commit_membership_id);
--> statement-breakpoint
-- تقديم الخدمة يمنع استخدام فهرسها لمسح كل مكونات النشاط عند فحص هوية مكوّن جديد بلا إحصاءات.
CREATE INDEX CONCURRENTLY package_components_service_business_fk_idx ON public.package_components(company_id,service_id,business_id);
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS public.package_components_service_fk_idx;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- نفس أعمدة وعلاقات المفتاح الأجنبي؛ ترتيبها فقط يطابق الفهرس الداعم الجديد.
ALTER TABLE public.package_components DROP CONSTRAINT package_components_service_fk,
  ADD CONSTRAINT package_components_service_fk
  FOREIGN KEY(company_id,service_id,business_id) REFERENCES public.services(company_id,id,business_id) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.package_components VALIDATE CONSTRAINT package_components_service_fk;
--> statement-breakpoint
ALTER TABLE public.import_previews VALIDATE CONSTRAINT import_previews_commit_membership_fk;
