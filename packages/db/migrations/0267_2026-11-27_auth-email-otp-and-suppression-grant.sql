ALTER TABLE "auth_notification_attempts" DROP CONSTRAINT "auth_notification_attempts_template";--> statement-breakpoint
ALTER TABLE "auth_notification_attempts" DROP CONSTRAINT "auth_notification_attempts_deadline";--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" DROP CONSTRAINT "auth_otp_challenges_expiry";--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" DROP CONSTRAINT "auth_otp_challenges_context";--> statement-breakpoint
ALTER TABLE "auth_notification_attempts" ADD CONSTRAINT "auth_notification_attempts_template" CHECK (((("auth_notification_attempts"."channel" = 'WHATSAPP')
          AND ("auth_notification_attempts"."template_key" IN ('staff_otp','staff_pin_reset_otp'))
          AND "auth_notification_attempts"."template_revision" = 1 AND "auth_notification_attempts"."locale" IN ('ar','en'))
        OR (("auth_notification_attempts"."channel" = 'EMAIL')
          AND ("auth_notification_attempts"."template_key" IN ('password_reset_otp','staff_pin_reset_otp'))
          AND "auth_notification_attempts"."template_revision" = 1 AND "auth_notification_attempts"."locale" IN ('ar','en')
          AND "auth_notification_attempts"."provider_template_name" IS NULL)));--> statement-breakpoint
ALTER TABLE "auth_notification_attempts" ADD CONSTRAINT "auth_notification_attempts_deadline" CHECK (("auth_notification_attempts"."preparation_deadline" = "auth_notification_attempts"."created_at" + interval '200 milliseconds'
        AND (("auth_notification_attempts"."template_key" = 'staff_otp' AND "auth_notification_attempts"."send_deadline" = "auth_notification_attempts"."created_at" + interval '300 seconds')
          OR ("auth_notification_attempts"."template_key" IN ('password_reset_otp','staff_pin_reset_otp')
            AND "auth_notification_attempts"."send_deadline" = "auth_notification_attempts"."created_at" + interval '600 seconds'))));--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" ADD CONSTRAINT "auth_otp_challenges_expiry" CHECK ((("auth_otp_challenges"."device_context"->>'purpose' IN ('PASSWORD_RESET','STAFF_PIN_RESET')
          AND "auth_otp_challenges"."expires_at" = "auth_otp_challenges"."created_at" + interval '600 seconds')
        OR ((("auth_otp_challenges"."device_context"->>'purpose' IS NULL) OR ("auth_otp_challenges"."device_context"->>'purpose' = 'STAFF_PERSONAL'))
          AND "auth_otp_challenges"."expires_at" = "auth_otp_challenges"."created_at" + interval '300 seconds')));--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" ADD CONSTRAINT "auth_otp_challenges_context" CHECK ((jsonb_typeof("auth_otp_challenges"."device_context") = 'object' AND (
        ("auth_otp_challenges"."device_context" ?& ARRAY['companyId','businessId','branchId','deviceId']
          AND "auth_otp_challenges"."device_context" - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb
          AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'branchId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'deviceId') ~ '^[a-f0-9-]{36}$')
        OR ("auth_otp_challenges"."device_context" ?& ARRAY['purpose','companyId','businessId']
          AND "auth_otp_challenges"."device_context" - ARRAY['purpose','companyId','businessId'] = '{}'::jsonb
          AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$'
          AND "auth_otp_challenges"."device_context"->>'purpose' = 'STAFF_PERSONAL')
        OR ("auth_otp_challenges"."device_context" = '{"purpose":"PASSWORD_RESET"}'::jsonb)
        OR ("auth_otp_challenges"."device_context" ?& ARRAY['purpose','companyId','businessId','branchId','deviceId','channel']
          AND "auth_otp_challenges"."device_context" - ARRAY['purpose','companyId','businessId','branchId','deviceId','channel'] = '{}'::jsonb
          AND "auth_otp_challenges"."device_context"->>'purpose' = 'STAFF_PIN_RESET'
          AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'branchId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'deviceId') ~ '^[a-f0-9-]{36}$'
          AND "auth_otp_challenges"."device_context"->>'channel' IN ('EMAIL','WHATSAPP')))));
--> statement-breakpoint
-- الاعتماد بالإيميل بيتحقق من الحظر العام للإيميل زي ما الاعتماد بالواتساب بيتحقق من حظر الواتساب.
GRANT EXECUTE ON FUNCTION public.platform_email_is_suppressed(bytea) TO pospay_auth;
