import { createStaffOtpDatabase } from '@pospay/db';
import { createOtpCrypto } from './crypto.ts';
import { phaseRunner, type PreparationPhase, type PreparationFailure } from './diagnostics.ts';
import { challengeExpiry, preparationDeadline } from './policy.ts';
import type { OtpConfiguration } from './configuration.ts';
import type { StaffSessions } from '../staff-sessions.ts';
import type {
  OtpCapability,
  OtpRates,
  OtpSender,
  OtpStrategies,
  StaffDeviceContext,
  StaffEligibility,
} from './types.ts';

export interface StaffOtpApiOptions {
  readonly onFailure?: (phase: PreparationPhase, failure: PreparationFailure) => void;
  readonly onOutcome?: (
    outcome: 'PREPARATION_FAILED' | 'PREPARED' | 'NOT_AUTHORIZED' | 'ENQUEUE_FAILED' | 'AUTHORIZED',
  ) => void;
  readonly databaseUrl: string;
  readonly configuration: () => OtpConfiguration;
  readonly capability: OtpCapability;
  readonly rates: OtpRates;
  readonly sender: OtpSender;
  readonly strategies: OtpStrategies;
  readonly eligibility: StaffEligibility;
  readonly sessions: StaffSessions;
  readonly ids: { newId(): string };
  readonly clock: { now(): Date; waitUntil(deadline: Date): Promise<void> };
  readonly audit: (
    action: string,
    userId: string | null,
    device: StaffDeviceContext,
    challengeId?: string,
  ) => Promise<void>;
}

export function createStaffOtpApi(options: StaffOtpApiOptions) {
  let active = 0;
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.strategies.phoneLockKey,
  });
  const availability = async () => {
    try {
      const config = options.configuration();
      if (config.state !== 'READY' || !(await options.capability.ready())) return null;
      return config;
    } catch {
      return null;
    }
  };
  return {
    state: async () =>
      options.configuration().state === 'DISABLED'
        ? ('DISABLED' as const)
        : (await availability()) === null
          ? ('UNAVAILABLE' as const)
          : ('READY' as const),
    request: (input: {
      phone: string;
      locale: 'ar' | 'en';
      ip: string;
      device: StaffDeviceContext;
    }) => {
      if (active >= 8) return Promise.resolve({ kind: 'unavailable' as const });
      active++;
      return otpRequest(options, database, availability, input).finally(() => {
        active--;
      });
    },
    verify: (input: {
      challengeId: string;
      code: string;
      ip: string;
      device: StaffDeviceContext;
    }) => otpVerify(options, database, availability, input),
    readiness: () => database.ping(),
    close: () => database.close(),
  };
}

async function prepareRequest(
  options: StaffOtpApiOptions,
  database: ReturnType<typeof createStaffOtpDatabase>,
  config: Extract<OtpConfiguration, { state: 'READY' }>,
  input: { phone: string; locale: 'ar' | 'en'; device: StaffDeviceContext },
  identity: ReturnType<OtpStrategies['identify']>,
  window: { createdAt: Date; deadline: Date; challengeId: string; attemptId: string },
): Promise<void> {
  const run = phaseRunner(options.onFailure);
  const userId = await run('LOOKUP', () => database.lookup(input.phone, window.deadline));
  const eligible =
    userId !== null &&
    (await run('ELIGIBILITY', () =>
      options.eligibility.eligible(userId, input.device, window.deadline),
    ));
  const crypto = createOtpCrypto(config.keys);
  const challenge = {
    id: window.challengeId,
    recipientHash: Buffer.from(identity.hash),
    hashKeyId: identity.hashKeyId,
    userId,
    deviceContext: input.device,
    codeMac: null,
    derivationKeyId: config.keys.derivationId,
    verificationKeyId: config.keys.verificationId,
    status: 'ACTIVE',
    failedAttempts: 0,
    createdAt: window.createdAt,
    expiresAt: challengeExpiry(window.createdAt),
  };
  const prepared = await run('PREPARATION', () =>
    database.prepare({
      eligible,
      challenge,
      attemptId: window.attemptId,
      locale: input.locale,
      providerTemplateName: config.templates[input.locale],
      preparationDeadline: window.deadline,
      materializeMac: () => crypto.mac(challenge, crypto.derive(challenge)),
    }),
  );
  if (!prepared) {
    options.onOutcome?.('NOT_AUTHORIZED');
    return;
  }
  options.onOutcome?.('PREPARED');
  await authorizePrepared(options, database, window);
}

async function authorizePrepared(
  options: StaffOtpApiOptions,
  database: ReturnType<typeof createStaffOtpDatabase>,
  window: { deadline: Date; challengeId: string; attemptId: string },
): Promise<void> {
  const run = phaseRunner(options.onFailure);
  try {
    await run('ENQUEUE', () =>
      options.sender.enqueue(
        { challengeId: window.challengeId, attemptId: window.attemptId },
        window.deadline,
      ),
    );
    const authorized = await run('RELEASE', () =>
      database.release(window.challengeId, window.attemptId, window.deadline, () =>
        options.capability.ready(window.deadline),
      ),
    );
    options.onOutcome?.(authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
  } catch {
    options.onOutcome?.('ENQUEUE_FAILED');
    await database
      .failPreparation(window.challengeId, window.attemptId, window.deadline)
      .catch(() => undefined);
  }
}

export type StaffOtpApi = ReturnType<typeof createStaffOtpApi>;

const otpRequest = async (
  options: StaffOtpApiOptions,
  database: ReturnType<typeof createStaffOtpDatabase>,
  availability: () => Promise<Extract<OtpConfiguration, { state: 'READY' }> | null>,
  input: {
    phone: string;
    locale: 'ar' | 'en';
    ip: string;
    device: StaffDeviceContext;
  },
) => {
  const config = await availability();
  if (config === null) return { kind: 'unavailable' as const };
  const identity = options.strategies.identify(input.phone);
  let rate: number;
  try {
    rate = await options.rates.request(identity.hash, input.ip);
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
    return { kind: 'unavailable' as const };
  }
  if (rate > 0) return { kind: 'limited' as const, retryAfter: rate };
  const createdAt = options.clock.now();
  const deadline = preparationDeadline(createdAt);
  const challengeId = options.ids.newId();
  const attemptId = options.ids.newId();
  try {
    await prepareRequest(options, database, config, input, identity, {
      createdAt,
      deadline,
      challengeId,
      attemptId,
    });
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
  }
  await options.clock.waitUntil(deadline);
  return { kind: 'accepted' as const, challengeId };
};

const otpVerify = async (
  options: StaffOtpApiOptions,
  database: ReturnType<typeof createStaffOtpDatabase>,
  availability: () => Promise<Extract<OtpConfiguration, { state: 'READY' }> | null>,
  input: {
    challengeId: string;
    code: string;
    ip: string;
    device: StaffDeviceContext;
  },
) => {
  const config = await availability();
  if (config === null) return { kind: 'unavailable' as const };
  const crypto = createOtpCrypto(config.keys);
  try {
    const candidate = await database.find(input.challengeId);
    const rate = await options.rates.verify(candidate?.recipientHash ?? null, input.ip);
    if (rate > 0) return { kind: 'limited' as const, retryAfter: rate };
    if (
      candidate?.userId === null ||
      candidate?.userId === undefined ||
      !(await options.eligibility.deviceValid(input.device)) ||
      !(await options.eligibility.eligible(candidate.userId, input.device))
    ) {
      crypto.dummy(input.code);
      return { kind: 'invalid' as const };
    }
    let compared = false;
    const userId = await database.consume(
      input.challengeId,
      input.device,
      (c) => {
        compared = true;
        return crypto.compare(c, input.code);
      },
      (phone) => options.strategies.identify(phone).hash,
    );
    if (!compared) crypto.dummy(input.code);
    if (
      userId === null ||
      !(await options.eligibility.deviceValid(input.device)) ||
      !(await options.eligibility.eligible(userId, input.device))
    )
      return { kind: 'invalid' as const };
    return await issueVerified(options, database, candidate.recipientHash, userId, input);
  } catch {
    crypto.dummy(input.code);
    return { kind: 'invalid' as const };
  }
};

async function issueVerified(
  options: StaffOtpApiOptions,
  database: ReturnType<typeof createStaffOtpDatabase>,
  hash: Uint8Array,
  userId: string,
  input: { device: StaffDeviceContext; challengeId: string },
) {
  if (
    !(await database.mappingValid(userId, hash, (phone) => options.strategies.identify(phone).hash))
  )
    return { kind: 'invalid' as const };
  const issued = await options.sessions.issue(userId, input.device);
  if (
    !(await database.mappingValid(
      userId,
      hash,
      (phone) => options.strategies.identify(phone).hash,
    )) ||
    !(await options.eligibility.deviceValid(input.device)) ||
    !(await options.eligibility.eligible(userId, input.device))
  ) {
    await options.sessions.signOut(
      new Headers({ cookie: issued.cookie.split(';')[0] ?? '' }),
      input.device,
    );
    return { kind: 'invalid' as const };
  }
  try {
    await options.audit('staff.otp_signed_in', userId, input.device, input.challengeId);
  } catch {
    await options.sessions.signOut(
      new Headers({ cookie: issued.cookie.split(';')[0] ?? '' }),
      input.device,
    );
    return { kind: 'invalid' as const };
  }
  return { kind: 'verified' as const, ...issued };
}
