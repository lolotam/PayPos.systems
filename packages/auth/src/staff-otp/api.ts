import { createStaffOtpDatabase } from '@pospay/db';
import { createOtpCrypto } from './crypto.ts';
import { phaseRunner, type PreparationPhase, type PreparationFailure } from './diagnostics.ts';
import { challengeExpiry, preparationDeadline, STAFF_LOGIN_CONCURRENCY } from './policy.ts';
import { otpVerify } from './verify.ts';
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
  readonly onCapabilityState?: (state: 'DISABLED' | 'UNAVAILABLE' | 'READY') => void;
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
  let previousState: 'DISABLED' | 'UNAVAILABLE' | 'READY' | undefined;
  const report = (state: 'DISABLED' | 'UNAVAILABLE' | 'READY') => {
    if (state !== previousState) options.onCapabilityState?.(state);
    previousState = state;
  };
  const availability = async () => {
    try {
      const config = options.configuration();
      if (config.state !== 'READY') {
        report(config.state);
        return null;
      }
      if (!(await phaseRunner(options.onFailure)('CAPABILITY', () => options.capability.ready()))) {
        report('UNAVAILABLE');
        return null;
      }
      report('READY');
      return config;
    } catch {
      report('UNAVAILABLE');
      return null;
    }
  };
  return {
    state: async () => {
      await availability();
      return previousState ?? 'UNAVAILABLE';
    },
    request: (input: {
      phone: string;
      locale: 'ar' | 'en';
      ip: string;
      device: StaffDeviceContext;
    }) => {
      if (active >= STAFF_LOGIN_CONCURRENCY)
        return Promise.resolve({ kind: 'unavailable' as const });
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
    }) => otpVerify({ options, database, availability, input }),
    readiness: () => database.ping(),
    close: () => database.close(),
  };
}

async function prepareRequest(request: {
  options: StaffOtpApiOptions;
  database: ReturnType<typeof createStaffOtpDatabase>;
  config: Extract<OtpConfiguration, { state: 'READY' }>;
  input: { phone: string; locale: 'ar' | 'en'; device: StaffDeviceContext };
  identity: ReturnType<OtpStrategies['identify']>;
  window: { createdAt: Date; deadline: Date; challengeId: string; attemptId: string };
}): Promise<void> {
  const { options, database, config, input, identity, window } = request;
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
  const challengeId = options.ids.newId();
  let rate: number;
  try {
    rate = await options.rates.request(identity.hash, input.ip, challengeId);
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
    return { kind: 'unavailable' as const };
  }
  if (rate > 0) return { kind: 'limited' as const, retryAfter: rate };
  const createdAt = options.clock.now();
  const deadline = preparationDeadline(createdAt);
  const attemptId = options.ids.newId();
  try {
    await prepareRequest({
      options,
      database,
      config,
      input,
      identity,
      window: { createdAt, deadline, challengeId, attemptId },
    });
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
  }
  await options.clock.waitUntil(deadline);
  return { kind: 'accepted' as const, challengeId };
};
