-- قرارا المالك PK-Q24 وPK-Q26 (2026-10-24): تفعيل مفتاح مرتجع الباقات المستوردة على شكل صلاحية 058-46-2a-S.
-- صف الكتالوج وصف الـ owner الافتراضي، والاتنين ON CONFLICT DO NOTHING لأن الـ seed قد سبقنا؛ الشكل كـ 0148.
INSERT INTO permissions(code) VALUES ('manage:imported-refunds:business') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
 ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:imported-refunds:business')
ON CONFLICT DO NOTHING;
