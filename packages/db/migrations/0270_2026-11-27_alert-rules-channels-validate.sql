-- التحقق من قيد alert_rules_channels في ملف مستقل عن إضافته NOT VALID (CLAUDE.md §10، V3.33).
ALTER TABLE "alert_rules" VALIDATE CONSTRAINT "alert_rules_channels";
