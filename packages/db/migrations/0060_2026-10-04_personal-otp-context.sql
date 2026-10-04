ALTER TABLE "auth_otp_challenges" DROP CONSTRAINT "auth_otp_challenges_context";--> statement-breakpoint
ALTER TABLE "auth_otp_challenges" ADD CONSTRAINT "auth_otp_challenges_context" CHECK (jsonb_typeof("auth_otp_challenges"."device_context") = 'object'
        AND ("auth_otp_challenges"."device_context"->>'companyId') ~ '^[a-f0-9-]{36}$'
        AND ("auth_otp_challenges"."device_context"->>'businessId') ~ '^[a-f0-9-]{36}$'
        AND (("auth_otp_challenges"."device_context" ?& ARRAY['companyId','businessId','branchId','deviceId']
          AND "auth_otp_challenges"."device_context" - ARRAY['companyId','businessId','branchId','deviceId'] = '{}'::jsonb
          AND ("auth_otp_challenges"."device_context"->>'branchId') ~ '^[a-f0-9-]{36}$'
          AND ("auth_otp_challenges"."device_context"->>'deviceId') ~ '^[a-f0-9-]{36}$')
        OR ("auth_otp_challenges"."device_context" ?& ARRAY['purpose','companyId','businessId']
          AND "auth_otp_challenges"."device_context" - ARRAY['purpose','companyId','businessId'] = '{}'::jsonb
          AND "auth_otp_challenges"."device_context"->>'purpose' = 'STAFF_PERSONAL')));