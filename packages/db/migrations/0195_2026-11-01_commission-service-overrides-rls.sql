-- رقم محلي مؤقت للتجربة الخاصة؛ يتحدد الرقم النهائي مقابل main بعد إذن مسار الدمج.
-- الجدول نفسه مولّد من الـ schema في مدخل سابق، وسياسة العزل هنا في مدخل custom مستقل.
-- عزل شركة كل تجاوز هو آخر خط دفاع، حتى لو وصل معرّف موظف أو خدمة من شركة أخرى.
ALTER TABLE commission_service_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- فرض السياسة يمنع أي مسار تشغيلي من تجاوز عزل المستأجر.
ALTER TABLE commission_service_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- القراءة لا تعرض إلا تجاوزات الشركة المرتبطة بالمعاملة الحالية.
CREATE POLICY commission_service_overrides_select ON commission_service_overrides FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
-- الإدراج يقبل فقط صفاً يخص الشركة نفسها، فلا يمكن زرع تجاوز لمستأجر آخر.
CREATE POLICY commission_service_overrides_insert ON commission_service_overrides FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
-- سجل التجاوزات تاريخي: لا تعديل ولا حذف؛ كل تغيير يصبح سطراً جديداً بترتيب المحرك.
REVOKE ALL ON commission_service_overrides FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications;
--> statement-breakpoint
-- التطبيق يحتاج قراءة السجل وإضافة سطور فقط، ولا يحصل أي دور آخر على منح.
GRANT SELECT, INSERT ON commission_service_overrides TO pospay_app;
