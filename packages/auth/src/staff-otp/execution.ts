import { createStaffOtpDatabase } from '@pospay/db';
import { createOtpCrypto } from './crypto.ts';
import type { OtpConfiguration } from './configuration.ts';
import type { OtpCapability, OtpStrategies } from './types.ts';

export function createStaffOtpExecution(options: {
  databaseUrl: string;
  configuration(): OtpConfiguration;
  capability: OtpCapability;
  strategies: OtpStrategies;
}) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.strategies.phoneLockKey,
  });
  return {
    pending: database.pending,
    timeout: database.timeout,
    claim: async (challengeId: string, attemptId: string, executionId: string) =>
      (await options.capability.ready()) &&
      (await database.claim(challengeId, attemptId, executionId)),
    materialize: async (challengeId: string, attemptId: string, executionId: string) => {
      const config = options.configuration();
      if (config.state !== 'READY' || !(await options.capability.ready())) return null;
      const found = await database.materialize(challengeId, attemptId, executionId);
      if (found === null) return null;
      const identity = options.strategies.identify(found.phone);
      if (
        !identity.valid ||
        identity.hashKeyId !== found.challenge.hashKeyId ||
        !Buffer.from(identity.hash).equals(found.challenge.recipientHash)
      )
        return null;
      try {
        const crypto = createOtpCrypto(config.keys);
        const code = crypto.derive(found.challenge);
        if (!crypto.compare(found.challenge, code)) return null;
        return { phone: found.phone, code, deadline: found.challenge.expiresAt };
      } catch {
        return null;
      }
    },
    finish: database.finish,
    retention: (limit: number) => database.cleanup(limit, false),
    readiness: database.ping,
    close: database.close,
  };
}

export type StaffOtpExecution = ReturnType<typeof createStaffOtpExecution>;

/** تنظيف الهوية كل ساعة، مستقل عن تفعيل النقل ومفاتيح اشتقاق الرمز؛ لا يمنح أي إذن إرسال. */
export function createStaffOtpMaintenance(options: {
  databaseUrl: string;
  phoneLockKey(hash: Uint8Array): bigint;
  onFailure(): void;
}) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  let stopped = false,
    active: Promise<void> | undefined;
  const run = async () => {
    if (stopped || active !== undefined) return;
    active = (async () => {
      await database.ping();
      await database.cleanup(100, false);
    })().finally(() => {
      active = undefined;
    });
    await active;
  };
  const timer = setInterval(() => {
    void run().catch(() => options.onFailure());
  }, 3_600_000);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  return {
    run,
    stop,
    close: async () => {
      stop();
      await active?.catch(() => undefined);
      await database.close();
    },
  };
}
