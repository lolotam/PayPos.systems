import type { StaffOtpDatabase } from '@pospay/db';
import type { StaffOtpApiOptions } from './api.ts';
import type { OtpConfiguration } from './configuration.ts';
import { createOtpCrypto } from './crypto.ts';
import { phaseRunner } from './diagnostics.ts';
import { preparationDeadline } from './policy.ts';
import type { StaffDeviceContext } from './types.ts';

interface Verification {
  options: StaffOtpApiOptions;
  database: StaffOtpDatabase;
  availability(): Promise<Extract<OtpConfiguration, { state: 'READY' }> | null>;
  input: { challengeId: string; code: string; ip: string; device: StaffDeviceContext };
}

export async function otpVerify(request: Verification) {
  const { options, database, availability, input } = request;
  const config = await availability();
  if (config === null) return { kind: 'unavailable' as const };
  const rate = await verifyRate(options, input);
  if (rate === null) return { kind: 'unavailable' as const };
  const deadline = preparationDeadline(options.clock.now());
  const crypto = createOtpCrypto(config.keys);
  const run = phaseRunner(options.onFailure);
  try {
    if (rate > 0) return { kind: 'limited' as const, retryAfter: rate };
    const candidate = await run('VERIFY_LOOKUP', () => database.find(input.challengeId, deadline));
    if (
      candidate?.userId === null ||
      candidate?.userId === undefined ||
      !(await run('VERIFY_PROOF', () =>
        eligible(options, candidate.userId as string, input.device, deadline),
      ))
    ) {
      crypto.dummy(input.code);
      return { kind: 'invalid' as const };
    }
    let compared = false;
    const userId = await run('VERIFY_PROOF', () =>
      database.consume(
        input.challengeId,
        input.device,
        (c) => {
          compared = true;
          return crypto.compare(c, input.code);
        },
        (phone) => options.strategies.identify(phone).hash,
        deadline,
      ),
    );
    if (!compared) crypto.dummy(input.code);
    if (userId === null) return { kind: 'invalid' as const };
    return await run('VERIFY_SESSION', () =>
      issueVerified({
        options,
        database,
        hash: candidate.recipientHash,
        userId,
        input,
      }),
    );
  } catch {
    crypto.dummy(input.code);
    // فشل قفل تحدٍ مؤهل لا يكشف الأهلية؛ الرد العام بعد صرف الإلغاء داخل المهلة (ADR-0019 §6).
    return { kind: 'invalid' as const };
  } finally {
    await options.clock.waitUntil(deadline);
  }
}

async function verifyRate(options: StaffOtpApiOptions, input: Verification['input']) {
  try {
    return await phaseRunner(options.onFailure)('VERIFY_RATE', () =>
      options.rates.verify(input.challengeId, input.ip),
    );
  } catch {
    return null;
  }
}

async function eligible(
  options: StaffOtpApiOptions,
  userId: string,
  device: StaffDeviceContext,
  deadline?: Date,
) {
  return (
    (await options.eligibility.deviceValid(device, deadline)) &&
    (await options.eligibility.eligible(userId, device, deadline))
  );
}

async function issueVerified(request: {
  options: StaffOtpApiOptions;
  database: StaffOtpDatabase;
  hash: Uint8Array;
  userId: string;
  input: { device: StaffDeviceContext; challengeId: string };
}) {
  const { options, database, hash, userId, input } = request;
  const mapping = () =>
    database.mappingValid(userId, hash, (phone) => options.strategies.identify(phone).hash);
  if (!(await mapping()) || !(await eligible(options, userId, input.device)))
    return { kind: 'invalid' as const };
  const issued = await options.sessions.issue(userId, input.device, async () => {
    if (!(await mapping()) || !(await eligible(options, userId, input.device))) return false;
    await options.audit('staff.otp_signed_in', userId, input.device, input.challengeId);
    return true;
  });
  return { kind: 'verified' as const, ...issued };
}
