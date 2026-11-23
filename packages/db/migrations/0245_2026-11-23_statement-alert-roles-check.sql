-- القيد بيتضاف NOT VALID أولاً (لحظة قفل قصيرة بدون مسح): من اللحظة دي مفيش أي كاتب يقدر يخزّن مدير الفرع على نوعي كشف العمولات،
-- حتى لو الحاوية القديمة لسه شغالة. الصفوف القديمة بتتنضّف وبتتعمل لها VALIDATE في الـ migration اللي بعدها (0246).
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_statement_roles" CHECK ("alert_rules"."kind" NOT IN ('STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL') OR NOT ('branch_manager' = ANY("alert_rules"."recipient_roles"))) NOT VALID;
