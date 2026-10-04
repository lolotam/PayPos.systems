-- DOC-Q2 (افتراض موصى به): المالك والمدير العام افتراضياً، مدير النشاط بتفويض شخصي فقط، والجهاز ممنوع.
INSERT INTO permissions(code) VALUES ('manage:document-types:company') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code) VALUES
 ('01920000-0000-7000-8000-000000000101','global',NULL,'manage:document-types:company'),
 ('01920000-0000-7000-8000-000000000102','global',NULL,'manage:document-types:company')
ON CONFLICT DO NOTHING;
