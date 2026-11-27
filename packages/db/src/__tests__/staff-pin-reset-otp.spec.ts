import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpFixture } from '../../test/otp-fixtures.ts';
import type { EmailResetPreparation } from '../password-reset-otp.ts';
import type { StaffPinResetContext } from '../staff-pin-reset-otp.ts';

// دورة اعتماد استرجاع الرقم السري للموظفة على pospay_auth (spec 079 PR-c1): التحضير بسياق الجهاز والقناة،
// وفحص الكود على نفس الجهاز بس، والاستهلاك مرة واحدة، ووجهة الإيميل بتتسلّم null لأنها عمود في جدول الشركة.
let f: Awaited<ReturnType<typeof otpFixture>>;
beforeAll(async () => {
  f = await otpFixture();
  await f.db.warm();
});
afterAll(async () => {
  await f?.close();
});

const context = (channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL'): StaffPinResetContext => ({
  purpose: 'STAFF_PIN_RESET',
  companyId: randomUUID(),
  businessId: randomUUID(),
  branchId: randomUUID(),
  deviceId: randomUUID(),
  channel,
});

async function seedStaff() {
  const id = randomUUID();
  await f.owner`INSERT INTO "user"(id,name,email,email_verified)
    VALUES(${id},'synthetic',${`staff-${id}@staff.pospay.invalid`},true)`;
  return id;
}

function preparation(
  userId: string | null,
  device: StaffPinResetContext,
  overrides: Partial<EmailResetPreparation> = {},
): EmailResetPreparation {
  const createdAt = new Date();
  return {
    challengeId: randomUUID(),
    attemptId: randomUUID(),
    recipientHash: randomBytes(32),
    hashKeyId: 'synthetic-h',
    userId,
    locale: 'en',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 600_000),
    preparationDeadline: new Date(createdAt.getTime() + 200),
    derivationKeyId: 'synthetic-d',
    verificationKeyId: 'synthetic-v',
    eligible: userId !== null,
    auditId: randomUUID(),
    materializeMac: () => Buffer.alloc(32, 13),
    staffPin: { context: device, providerTemplateName: null },
    ...overrides,
  };
}

const compareAlways = (value: boolean) => () => value;

async function challengeRow(id: string) {
  const [row] = await f.owner`SELECT status, code_mac, failed_attempts, device_context
    FROM auth_otp_challenges WHERE id=${id}`;
  return row;
}

describe('preparing a PIN recovery challenge', () => {
  it('stores the device context with its channel and an email attempt on the PIN template', async () => {
    const device = context();
    const input = preparation(await seedStaff(), device);
    expect(await f.db.prepareEmailResetChallenge(input)).toBe('PREPARED');
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'ACTIVE',
      device_context: device,
    });
    const [attempt] = await f.owner`SELECT channel, template_key, provider_template_name,
      extract(epoch FROM send_deadline - created_at)::int AS lifetime
      FROM auth_notification_attempts WHERE id=${input.attemptId}`;
    expect(attempt).toEqual({
      channel: 'EMAIL',
      template_key: 'staff_pin_reset_otp',
      provider_template_name: null,
      lifetime: 600,
    });
    const [audit] = await f.owner`SELECT action FROM platform_audit_log WHERE id=${input.auditId}`;
    expect(audit).toEqual({ action: 'staffpin.reset_requested' });
  });

  it('writes nothing for an ineligible request and keeps WhatsApp on the WhatsApp attempt channel', async () => {
    const refused = preparation(null, context());
    expect(await f.db.prepareEmailResetChallenge(refused)).toBe('REFUSED');
    expect(await challengeRow(refused.challengeId)).toBeUndefined();
    const whatsapp = context('WHATSAPP');
    const sendable = preparation(await seedStaff(), whatsapp, {
      staffPin: { context: whatsapp, providerTemplateName: 'synthetic_pin_template' },
    });
    expect(await f.db.prepareEmailResetChallenge(sendable)).toBe('PREPARED');
    const [attempt] = await f.owner`SELECT channel, template_key, provider_template_name
      FROM auth_notification_attempts WHERE id=${sendable.attemptId}`;
    expect(attempt).toEqual({
      channel: 'WHATSAPP',
      template_key: 'staff_pin_reset_otp',
      provider_template_name: 'synthetic_pin_template',
    });
  });
});

async function prepared() {
  const device = context();
  const input = preparation(await seedStaff(), device);
  await f.db.prepareEmailResetChallenge(input);
  return { device, input };
}

describe('verifying the code', () => {
  it('counts wrong codes up to five and then ends the challenge without a MAC', async () => {
    const { device, input } = await prepared();
    for (let attempt = 1; attempt < 5; attempt += 1)
      expect(
        await f.db.verifyStaffPinResetOtp(
          input.challengeId,
          device,
          compareAlways(false),
          randomUUID(),
        ),
      ).toBe('INVALID');
    expect(
      await f.db.verifyStaffPinResetOtp(
        input.challengeId,
        device,
        compareAlways(false),
        randomUUID(),
      ),
    ).toBe('EXHAUSTED');
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'EXHAUSTED',
      code_mac: null,
      failed_attempts: 5,
    });
    const [audit] = await f.owner`SELECT action FROM platform_audit_log
      WHERE target_user_id=${input.userId} AND action='staffpin.reset_exhausted'`;
    expect(audit).toEqual({ action: 'staffpin.reset_exhausted' });
  });

  it('ignores a code presented from another device without touching the counter', async () => {
    const { input } = await prepared();
    expect(
      await f.db.verifyStaffPinResetOtp(
        input.challengeId,
        context(),
        compareAlways(true),
        randomUUID(),
      ),
    ).toBe('INVALID');
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'ACTIVE',
      failed_attempts: 0,
    });
    expect(
      await f.db.consumeStaffPinResetOtp({
        challengeId: input.challengeId,
        device: context(),
        compare: compareAlways(true),
      }),
    ).toBeNull();
  });
});

describe('consuming the code', () => {
  it('consumes a matching code exactly once and returns its owner and recipient hash', async () => {
    const { device, input } = await prepared();
    expect(
      await f.db.verifyStaffPinResetOtp(
        input.challengeId,
        device,
        compareAlways(true),
        randomUUID(),
      ),
    ).toBe('MATCH');
    const consumed = await f.db.consumeStaffPinResetOtp({
      challengeId: input.challengeId,
      device,
      compare: compareAlways(true),
    });
    expect(consumed).toEqual({ userId: input.userId, recipientHash: input.recipientHash });
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'CONSUMED',
      code_mac: null,
    });
    expect(
      await f.db.consumeStaffPinResetOtp({
        challengeId: input.challengeId,
        device,
        compare: compareAlways(true),
      }),
    ).toBeNull();
  });

  it('does not consume on a wrong code and never accepts a password-reset challenge', async () => {
    const { device, input } = await prepared();
    expect(
      await f.db.consumeStaffPinResetOtp({
        challengeId: input.challengeId,
        device,
        compare: compareAlways(false),
      }),
    ).toBeNull();
    expect(await challengeRow(input.challengeId)).toMatchObject({ status: 'ACTIVE' });
    const owner = randomUUID();
    await f.owner`INSERT INTO "user"(id,name,email,email_verified) VALUES(${owner},'synthetic',${`o-${owner}@otp.invalid`},true)`;
    const { staffPin, ...plain } = preparation(owner, device);
    void staffPin;
    await f.db.prepareEmailResetChallenge(plain);
    expect(
      await f.db.consumeStaffPinResetOtp({
        challengeId: plain.challengeId,
        device,
        compare: compareAlways(true),
      }),
    ).toBeNull();
  });
});

describe('materializing the attempt', () => {
  it('hands the executor no destination for an email PIN challenge, whose address lives with the tenant', async () => {
    const { device, input } = await prepared();
    const execution = randomUUID();
    const deadline = new Date(Date.now() + 1000);
    expect(await f.db.release(input.challengeId, input.attemptId, deadline, async () => true)).toBe(
      true,
    );
    expect(await f.db.claim(input.challengeId, input.attemptId, execution)).toBe(true);
    const found = await f.db.materialize(input.challengeId, input.attemptId, execution);
    expect(found).toMatchObject({ channel: 'EMAIL', destination: null });
    expect(found?.challenge.deviceContext).toEqual(device);
  });
});

it('never supersedes active challenges of another purpose or another company', async () => {
  const recipientHash = randomBytes(32);
  const companyA = context();
  const companyB = context();
  const pinA = preparation(await seedStaff(), companyA, { recipientHash });
  const pinB = preparation(await seedStaff(), companyB, { recipientHash });
  const { staffPin, ...plain } = preparation(await seedStaff(), companyA, { recipientHash });
  void staffPin;
  expect(await f.db.prepareEmailResetChallenge(pinA)).toBe('PREPARED');
  expect(await f.db.prepareEmailResetChallenge(pinB)).toBe('PREPARED');
  expect(await f.db.prepareEmailResetChallenge(plain)).toBe('PREPARED');
  expect(await challengeRow(pinA.challengeId)).toMatchObject({ status: 'ACTIVE' });
  expect(await challengeRow(pinB.challengeId)).toMatchObject({ status: 'ACTIVE' });
  expect(await challengeRow(plain.challengeId)).toMatchObject({ status: 'ACTIVE' });
});
