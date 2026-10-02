import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createStaffOtpDatabase } from '../src/staff-otp-database.ts';
import type { OtpPreparation } from '../src/staff-otp-types.ts';
import { phoneLockKey } from '../../notifications/src/phone-identity.ts';
import { createTestDatabase } from './test-database.ts';

export const device = {
  companyId: randomUUID(),
  businessId: randomUUID(),
  branchId: randomUUID(),
  deviceId: randomUUID(),
};
export const hash = Buffer.alloc(32, 11);
export const phone = '+99900000001';
export const lockKey = phoneLockKey;

export async function otpFixture() {
  const test = await createTestDatabase();
  const owner = postgres(test.ownerUrl, { max: 4, onnotice: () => undefined });
  const db = createStaffOtpDatabase({ url: test.authUrl, phoneLockKey: lockKey });
  try {
    await warmOtpTables(owner);
    await db.ping();
    const userId = randomUUID();
    await owner`INSERT INTO "user"(id,name,email,email_verified,phone_number,phone_number_verified,phone_binding_approved_at)
    VALUES(${userId},'synthetic','synthetic@otp.invalid',true,${phone},false,clock_timestamp())`;
    return {
      test,
      owner,
      db,
      userId,
      input: (overrides: Partial<OtpPreparation> = {}) => preparation(userId, overrides),
      close: async () => {
        await Promise.allSettled([db.close(), owner.end()]);
        await test.drop();
      },
    };
  } catch (error) {
    await Promise.allSettled([db.close(), owner.end()]);
    await test.drop().catch(() => undefined);
    throw error;
  }
}

function preparation(userId: string, overrides: Partial<OtpPreparation>): OtpPreparation {
  const createdAt = new Date();
  return {
    challenge: {
      id: randomUUID(),
      recipientHash: hash,
      hashKeyId: 'synthetic-h',
      userId,
      deviceContext: device,
      codeMac: null,
      derivationKeyId: 'synthetic-d',
      verificationKeyId: 'synthetic-v',
      status: 'ACTIVE',
      failedAttempts: 0,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 300_000),
    },
    attemptId: randomUUID(),
    locale: 'ar',
    providerTemplateName: 'synthetic_ar',
    preparationDeadline: new Date(createdAt.getTime() + 200),
    materializeMac: () => Buffer.alloc(32, 13),
    ...overrides,
  };
}

export async function warmOtpTables(owner: postgres.Sql): Promise<void> {
  // تجهيز صفحات الجدولين قبل قياس مهلة الطلب؛ COMMIT حقيقي وfsync كما هو، ولا تبقى بيانات تجهيز.
  const challenge = randomUUID(),
    attempt = randomUUID();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,device_context,status,created_at,expires_at,finished_at,updated_at)
      VALUES(${challenge},${hash},'synthetic-h',${tx.json(device)},'SUPPRESSED',statement_timestamp(),statement_timestamp()+interval '300 seconds',statement_timestamp(),statement_timestamp())`;
    await tx`INSERT INTO auth_notification_attempts(id,challenge_id,recipient_hash,hash_key_id,channel,template_key,template_revision,locale,status,send_deadline,preparation_deadline,created_at,finished_at,updated_at)
      SELECT ${attempt},id,recipient_hash,hash_key_id,'WHATSAPP','staff_otp',1,'ar','SUPPRESSED',expires_at,created_at+interval '200 milliseconds',created_at,finished_at,updated_at
      FROM auth_otp_challenges WHERE id=${challenge}`;
    await tx`DELETE FROM auth_notification_attempts WHERE id=${attempt}`;
    await tx`DELETE FROM auth_otp_challenges WHERE id=${challenge}`;
  });
}
