import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpFixture, hash, device } from '../../test/otp-fixtures.ts';
import type { EmailResetPreparation } from '../password-reset-otp.ts';

let f: Awaited<ReturnType<typeof otpFixture>>;
beforeAll(async () => {
  f = await otpFixture();
  // الاتصالات كلها تتسخّن قبل نافذة التحضير الثابتة (200ms)، وإلا أول اختبار بيقع على اتصال بارد.
  await f.db.warm();
});
afterAll(async () => {
  await f?.close();
});

/** مستخدم اعتماد جديد بإيميله، بلا حساب دخول؛ staff يخليه حساب موظف اصطناعي. */
async function seedOwner(overrides: { staff?: boolean } = {}) {
  const id = randomUUID();
  const email = `owner.${id}@otp.invalid`;
  const operation = overrides.staff === true ? randomUUID() : null;
  const company = overrides.staff === true ? randomUUID() : null;
  await f.owner`INSERT INTO "user"(id,name,email,email_verified,staff_access_operation_id,staff_access_company_id)
    VALUES(${id},'synthetic',${email},true,${operation},${company})`;
  return { id, email };
}

function preparation(
  userId: string | null,
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
    ...overrides,
  };
}

async function challengeRow(id: string) {
  const [row] = await f.owner`SELECT status, code_mac, user_id, failed_attempts, device_context
    FROM auth_otp_challenges WHERE id=${id}`;
  return row;
}

describe('pospay_auth keeps only the exact ADR-0019 grants (079 PR-b)', () => {
  it.each(['device_context', 'recipient_hash', 'created_at', 'user_id', 'expires_at'])(
    'cannot update the immutable challenge column %s',
    async (column) => {
      const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
      try {
        await expect(
          auth.unsafe(`UPDATE auth_otp_challenges SET ${column} = ${column} WHERE false`),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await auth.end();
      }
    },
  );

  it.each(['channel', 'template_key', 'recipient_hash', 'locale', 'send_deadline', 'challenge_id'])(
    'cannot update the immutable attempt column %s',
    async (column) => {
      const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
      try {
        await expect(
          auth.unsafe(`UPDATE auth_notification_attempts SET ${column} = ${column} WHERE false`),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await auth.end();
      }
    },
  );
});

describe('pospay_auth has no door into the global email tables (079 PR-b)', () => {
  it.each(['platform_email_suppressions', 'platform_email_feedback_inbox', 'platform_email_audit'])(
    'has no SELECT, INSERT, UPDATE, DELETE or TRUNCATE on %s',
    async (table) => {
      const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
      try {
        const [first] = await f.owner`SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position LIMIT 1`;
        const column = first?.['column_name'] as string;
        for (const statement of [
          `SELECT 1 FROM ${table}`,
          `INSERT INTO ${table} DEFAULT VALUES`,
          `UPDATE ${table} SET ${column} = ${column} WHERE false`,
          `DELETE FROM ${table} WHERE false`,
          `TRUNCATE ${table}`,
        ])
          await expect(auth.unsafe(statement)).rejects.toThrow(/permission denied/);
      } finally {
        await auth.end();
      }
    },
  );

  it('can execute the suppression check only, and reads a verdict for an unlisted hash', async () => {
    const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
    try {
      expect(await auth`SELECT platform_email_is_suppressed(${hash}) AS blocked`).toEqual([
        { blocked: false },
      ]);
    } finally {
      await auth.end();
    }
  });
});

describe('the widened CHECK constraints keep each purpose in its own shape', () => {
  const insertChallenge = (context: object, seconds: number) =>
    f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,device_context,status,created_at,expires_at,finished_at,updated_at)
      VALUES(${randomUUID()},${randomBytes(32)},'synthetic-h',${f.owner.json(context as never)},'EXPIRED',
        statement_timestamp(),statement_timestamp()+${seconds}*interval '1 second',statement_timestamp(),statement_timestamp())`;

  it('accepts PASSWORD_RESET at 600 seconds and refuses it at 300', async () => {
    await insertChallenge({ purpose: 'PASSWORD_RESET' }, 600);
    await expect(insertChallenge({ purpose: 'PASSWORD_RESET' }, 300)).rejects.toThrow(
      /auth_otp_challenges_expiry/,
    );
  });

  it('keeps the staff personal purpose at 300 seconds', async () => {
    const context = {
      purpose: 'STAFF_PERSONAL',
      companyId: randomUUID(),
      businessId: randomUUID(),
    };
    await insertChallenge(context, 300);
    await expect(insertChallenge(context, 600)).rejects.toThrow(/auth_otp_challenges_expiry/);
  });

  it('refuses a PASSWORD_RESET context that carries any extra key', async () => {
    await expect(
      insertChallenge({ purpose: 'PASSWORD_RESET', companyId: randomUUID() }, 600),
    ).rejects.toThrow(/auth_otp_challenges_context/);
  });

  it('accepts the STAFF_PIN_RESET shape with its channel and refuses an unknown channel', async () => {
    const context = {
      purpose: 'STAFF_PIN_RESET',
      companyId: randomUUID(),
      businessId: randomUUID(),
      branchId: randomUUID(),
      deviceId: randomUUID(),
      channel: 'EMAIL',
    };
    await insertChallenge(context, 600);
    await expect(insertChallenge({ ...context, channel: 'SMS' }, 600)).rejects.toThrow(
      /auth_otp_challenges_context/,
    );
  });
});

describe('the attempt constraints keep each template on its own channel and deadline', () => {
  {
    const insertAttempt = async (
      channel: string,
      template: string,
      seconds: number,
      providerTemplate: string | null,
    ) => {
      const challenge = randomUUID();
      await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,device_context,status,created_at,expires_at,finished_at,updated_at)
        VALUES(${challenge},${randomBytes(32)},'synthetic-h',${f.owner.json({ purpose: 'PASSWORD_RESET' })},'EXPIRED',
          statement_timestamp(),statement_timestamp()+interval '600 seconds',statement_timestamp(),statement_timestamp())`;
      return f.owner`INSERT INTO auth_notification_attempts(id,challenge_id,recipient_hash,hash_key_id,channel,template_key,template_revision,locale,provider_template_name,status,send_deadline,preparation_deadline,created_at,updated_at)
        SELECT ${randomUUID()},id,recipient_hash,hash_key_id,${channel},${template},1,'en',${providerTemplate},'PREPARED',
          created_at+${seconds}*interval '1 second',created_at+interval '200 milliseconds',created_at,created_at
        FROM auth_otp_challenges WHERE id=${challenge}`;
    };

    it('accepts an EMAIL password_reset_otp attempt without a provider template name', async () => {
      await insertAttempt('EMAIL', 'password_reset_otp', 600, null);
    });

    it('refuses password_reset_otp on WHATSAPP, staff_otp on EMAIL, and a provider name on EMAIL', async () => {
      const refused = /auth_notification_attempts_template/;
      await expect(
        insertAttempt('WHATSAPP', 'password_reset_otp', 600, 'synthetic'),
      ).rejects.toThrow(refused);
      await expect(insertAttempt('EMAIL', 'staff_otp', 300, null)).rejects.toThrow(refused);
      await expect(insertAttempt('EMAIL', 'password_reset_otp', 600, 'synthetic')).rejects.toThrow(
        refused,
      );
    });

    it('ties each template to its own deadline', async () => {
      const refused = /auth_notification_attempts_deadline/;
      await expect(insertAttempt('EMAIL', 'password_reset_otp', 300, null)).rejects.toThrow(
        refused,
      );
      await expect(insertAttempt('WHATSAPP', 'staff_otp', 600, 'synthetic')).rejects.toThrow(
        refused,
      );
    });
  }
});

describe('preparing a reset challenge', () => {
  it('prepares an active challenge and a prepared email attempt, valid for ten minutes', async () => {
    const owner = await seedOwner();
    const found = await f.db.lookupCredentialUserByEmail(owner.email);
    expect(found).toEqual({ id: owner.id, email: owner.email, staffAccessOperationId: null });
    const input = preparation(owner.id);
    expect(await f.db.prepareEmailResetChallenge(input)).toBe('PREPARED');
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'ACTIVE',
      user_id: owner.id,
      failed_attempts: 0,
      device_context: { purpose: 'PASSWORD_RESET' },
    });
    const [attempt] = await f.owner`SELECT channel, template_key, status, provider_template_name,
      extract(epoch FROM send_deadline - created_at)::int AS lifetime
      FROM auth_notification_attempts WHERE id=${input.attemptId}`;
    expect(attempt).toEqual({
      channel: 'EMAIL',
      template_key: 'password_reset_otp',
      status: 'PREPARED',
      provider_template_name: null,
      lifetime: 600,
    });
  });

  it('supersedes the earlier active challenge of the same recipient', async () => {
    const owner = await seedOwner();
    const recipientHash = randomBytes(32);
    const first = preparation(owner.id, { recipientHash });
    const second = preparation(owner.id, { recipientHash });
    await f.db.prepareEmailResetChallenge(first);
    await f.db.prepareEmailResetChallenge(second);
    expect(await challengeRow(first.challengeId)).toMatchObject({
      status: 'SUPERSEDED',
      code_mac: null,
    });
    expect(await challengeRow(second.challengeId)).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('refusing and suppressing a reset request', () => {
  it('writes nothing for an unknown or staff account, whatever the caller says', async () => {
    const unknown = preparation(null);
    expect(await f.db.prepareEmailResetChallenge(unknown)).toBe('REFUSED');
    expect(await challengeRow(unknown.challengeId)).toBeUndefined();
    const staff = await seedOwner({ staff: true });
    const ineligible = preparation(staff.id, { eligible: false });
    expect(await f.db.prepareEmailResetChallenge(ineligible)).toBe('REFUSED');
    expect(await challengeRow(ineligible.challengeId)).toBeUndefined();
  });

  it('records a suppressed email as a terminal row with no code, no user and no send', async () => {
    const owner = await seedOwner();
    const recipientHash = randomBytes(32);
    await f.owner`INSERT INTO platform_email_suppressions(recipient_hash,hash_key_id,source,first_suppressed_at,last_suppressed_at)
      VALUES(${recipientHash},'synthetic-h','BOUNCE',clock_timestamp(),clock_timestamp())`;
    const input = preparation(owner.id, { recipientHash });
    expect(await f.db.prepareEmailResetChallenge(input)).toBe('SUPPRESSED');
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'SUPPRESSED',
      code_mac: null,
      user_id: null,
    });
    const [attempt] =
      await f.owner`SELECT status FROM auth_notification_attempts WHERE id=${input.attemptId}`;
    expect(attempt).toEqual({ status: 'SUPPRESSED' });
  });
});

async function prepared() {
  const owner = await seedOwner();
  const recipientHash = randomBytes(32);
  const input = preparation(owner.id, { recipientHash });
  await f.db.prepareEmailResetChallenge(input);
  return { owner, input, recipientHash };
}

const consumption = (challengeId: string, recipientHash: Uint8Array, compare = () => true) => ({
  challengeId,
  passwordHash: 'synthetic-new-hash',
  accountId: randomUUID(),
  auditId: randomUUID(),
  compare,
  identify: () => recipientHash,
});

describe('verifying the code', () => {
  it('exhausts on the fifth wrong code and clears the MAC', async () => {
    const { input } = await prepared();
    const results = [];
    for (let i = 0; i < 5; i += 1)
      results.push(await f.db.verifyPasswordResetOtp(input.challengeId, () => false, randomUUID()));
    expect(results).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID', 'EXHAUSTED']);
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'EXHAUSTED',
      failed_attempts: 5,
      code_mac: null,
    });
    expect(await f.db.verifyPasswordResetOtp(input.challengeId, () => true, randomUUID())).toBe(
      'INVALID',
    );
  });

  it('refuses a staff challenge id and never moves its failed-attempts counter', async () => {
    const owner = await seedOwner();
    const challengeId = randomUUID();
    await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,code_mac,
      derivation_key_id,verification_key_id,status,failed_attempts,created_at,expires_at,updated_at)
      VALUES(${challengeId},${randomBytes(32)},'synthetic-h',${owner.id},${f.owner.json(device)},${Buffer.alloc(32, 13)},
        'synthetic-d','synthetic-v','ACTIVE',0,now(),now()+interval '10 minutes',now())`;
    expect(await f.db.verifyPasswordResetOtp(challengeId, () => false, randomUUID())).toBe(
      'INVALID',
    );
    expect(await challengeRow(challengeId)).toMatchObject({
      status: 'ACTIVE',
      failed_attempts: 0,
    });
  });
});

describe('consuming the code', () => {
  it('resets once: writes the password, ends every session and reset link, and keeps two_factor', async () => {
    const { owner, input, recipientHash } = await prepared();
    await f.owner`INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES(${randomUUID()},${owner.id},'credential',${owner.id},'synthetic-old-hash')`;
    for (const token of ['one', 'two'])
      await f.owner`INSERT INTO session(id,expires_at,token,user_id) VALUES(${randomUUID()},now()+interval '1 day',${`${token}-${owner.id}`},${owner.id})`;
    await f.owner`INSERT INTO verification(id,identifier,value,expires_at) VALUES(${randomUUID()},${`reset-password:${randomUUID()}`},${owner.id},now()+interval '1 hour')`;
    await f.owner`INSERT INTO verification(id,identifier,value,expires_at) VALUES(${randomUUID()},'email-verify:synthetic',${owner.id},now()+interval '1 hour')`;
    await f.owner`INSERT INTO two_factor(id,secret,backup_codes,user_id) VALUES(${randomUUID()},'synthetic','synthetic',${owner.id})`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.db.consumePasswordResetOtp(consumption(input.challengeId, recipientHash)),
      ),
    );
    expect(results.filter((r) => r === 'RESET')).toHaveLength(1);
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'CONSUMED',
      code_mac: null,
    });
    expect(await f.owner`SELECT password FROM account WHERE user_id=${owner.id}`).toEqual([
      { password: 'synthetic-new-hash' },
    ]);
    expect(await f.owner`SELECT id FROM session WHERE user_id=${owner.id}`).toEqual([]);
    expect(await f.owner`SELECT identifier FROM verification WHERE value=${owner.id}`).toEqual([
      { identifier: 'email-verify:synthetic' },
    ]);
    expect(await f.owner`SELECT id FROM two_factor WHERE user_id=${owner.id}`).toHaveLength(1);
    expect(
      await f.owner`SELECT action FROM platform_audit_log WHERE target_user_id=${owner.id} AND action LIKE 'reset.%'`,
    ).toEqual(
      expect.arrayContaining([{ action: 'reset.requested' }, { action: 'reset.completed' }]),
    );
  });
});

describe('consuming the code when the account state allows it', () => {
  it('creates the credential account when the user had none', async () => {
    const { owner, input, recipientHash } = await prepared();
    expect(await f.db.consumePasswordResetOtp(consumption(input.challengeId, recipientHash))).toBe(
      'RESET',
    );
    expect(await f.owner`SELECT provider_id FROM account WHERE user_id=${owner.id}`).toEqual([
      { provider_id: 'credential' },
    ]);
  });

  it('refuses a wrong code, an email that changed, and a user turned into staff', async () => {
    const wrong = await prepared();
    expect(
      await f.db.consumePasswordResetOtp(
        consumption(wrong.input.challengeId, wrong.recipientHash, () => false),
      ),
    ).toBe('INVALID');
    expect(await challengeRow(wrong.input.challengeId)).toMatchObject({ status: 'ACTIVE' });

    const moved = await prepared();
    expect(
      await f.db.consumePasswordResetOtp(
        consumption(moved.input.challengeId, Buffer.alloc(32, 99)),
      ),
    ).toBe('INVALID');

    const turned = await prepared();
    await f.owner`UPDATE "user" SET staff_access_operation_id=${randomUUID()}, staff_access_company_id=${randomUUID()} WHERE id=${turned.owner.id}`;
    expect(
      await f.db.consumePasswordResetOtp(
        consumption(turned.input.challengeId, turned.recipientHash),
      ),
    ).toBe('INVALID');
    expect(await challengeRow(turned.input.challengeId)).toMatchObject({ status: 'ACTIVE' });
  });

  it('refuses an expired challenge and marks it terminal without a MAC', async () => {
    const { input, recipientHash } = await prepared();
    await f.owner`ALTER TABLE auth_otp_challenges DISABLE TRIGGER USER`;
    try {
      await f.owner`UPDATE auth_otp_challenges SET created_at=created_at-interval '11 minutes',
        expires_at=expires_at-interval '11 minutes' WHERE id=${input.challengeId}`;
    } finally {
      await f.owner`ALTER TABLE auth_otp_challenges ENABLE TRIGGER USER`;
    }
    expect(await f.db.consumePasswordResetOtp(consumption(input.challengeId, recipientHash))).toBe(
      'INVALID',
    );
    expect(await challengeRow(input.challengeId)).toMatchObject({
      status: 'EXPIRED',
      code_mac: null,
    });
  });

  it('never accepts a staff OTP challenge as a password reset', async () => {
    const staff = f.input();
    await f.db.prepare(staff);
    expect(
      await f.db.consumePasswordResetOtp(
        consumption(staff.challenge.id, staff.challenge.recipientHash),
      ),
    ).toBe('INVALID');
  });
});
