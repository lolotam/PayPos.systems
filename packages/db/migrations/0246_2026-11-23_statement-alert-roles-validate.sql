-- pospay:data-step statement-alert-roles
-- الخطوة فوق بتشتغل قبل أول سطر هنا، بعد ما 0245 اتسجّلت: بتشيل مدير الفرع من القواعد القديمة (الـ UPDATE بتاعها بيحقق القيد
-- NOT VALID لأنه بيشيل الدور)، وبعدها VALIDATE بيمسح الجدول من غير ما يوقف الكتابة. لو حاوية قديمة حاولت تخزّن الدور في الفترة دي
-- قاعدة البيانات بترفضه، وده المقصود.
ALTER TABLE "alert_rules" VALIDATE CONSTRAINT "alert_rules_statement_roles";
