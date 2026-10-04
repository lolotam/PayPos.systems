-- قرار المالك 2026-10-04 (UNB-Q1): حزمة المديرين الأربعة معتمدة، دون تغيير أي تفويض شخصي.
INSERT INTO permissions(code) VALUES ('read:passkeys:branch'),('unbind:passkeys:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
 ('01920000-0000-7000-8000-000000000101','global',NULL,'read:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000102','global',NULL,'read:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000104','global',NULL,'read:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000105','global',NULL,'read:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000101','global',NULL,'unbind:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000102','global',NULL,'unbind:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000104','global',NULL,'unbind:passkeys:branch'),
 ('01920000-0000-7000-8000-000000000105','global',NULL,'unbind:passkeys:branch')
ON CONFLICT DO NOTHING;
