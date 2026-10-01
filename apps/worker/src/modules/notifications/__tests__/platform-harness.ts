import { createPlatformWhatsappDatabase, type PlatformWhatsappDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createPhoneIdentity, createProviderMessageDigest } from '@pospay/notifications';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createWhatsappInboxRepository } from '../../../../../api/src/modules/notifications/persistence/drizzle-whatsapp-inbox.repository.ts';
import { notificationHarness, PHONE, NOW } from './harness.ts';
import { createAuthorizationRepository } from '../persistence/drizzle-authorization.repository.ts';
import { createSuppressionGate } from '../persistence/drizzle-suppression.gate.ts';
import { AuthorizeNotification } from '../use-cases/authorize-notification/authorize-notification.ts';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import type { ScrubbedWhatsappMessage } from '../../../../../api/src/modules/notifications/domain/whatsapp-command.ts';

export function barrier() {
  let resolve = () => {};
  const wait = new Promise<void>((r) => {
    resolve = r;
  });
  return { wait, release: () => resolve() };
}

/** Models provider/job redelivery only for the two retryable deadline outcomes. */
export async function redeliver<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        attempt >= 20 ||
        !(error instanceof Error) ||
        !['TimeoutError', 'CommitOutcomeUnknownError'].includes(error.name)
      )
        throw error;
    }
  }
}

type AuthorizationSource = Awaited<
  ReturnType<Awaited<ReturnType<typeof notificationHarness>>['request']>
>;

interface PlatformHarness extends Awaited<ReturnType<typeof notificationHarness>> {
  global: PlatformWhatsappDatabase;
  owner: postgres.Sql;
  intake: postgres.Sql;
  identity: ReturnType<ReturnType<typeof createPhoneIdentity>['identify']>;
  message(id?: string): ScrubbedWhatsappMessage;
  accept(database?: PlatformWhatsappDatabase, id?: string): Promise<readonly string[]>;
  authorize(
    company?: string,
    held?: {
      entered: ReturnType<typeof barrier>;
      release: ReturnType<typeof barrier>;
      rollback?: boolean;
    },
    source?: AuthorizationSource,
  ): Promise<string>;
  waiting(): Promise<void>;
  freshCheck(company: string): Promise<boolean>;
}

export async function platformHarness(): Promise<PlatformHarness> {
  const base = await notificationHarness();
  const global = createPlatformWhatsappDatabase({ url: base.testDb.notificationsUrl });
  const owner = postgres(base.testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  const intake = postgres(base.testDb.notificationsUrl, { max: 1, onnotice: () => undefined });
  await global.ping();
  await base.db.ping();
  await owner`SELECT 1`;
  await intake`SELECT 1`;
  const ids = systemUuidV7();
  const identity = createPhoneIdentity('test-key-not-a-secret'.repeat(3), 'test-v1').identify(
    PHONE,
  );
  const digest = createProviderMessageDigest('test-secret'.repeat(4), 'test-v1');
  const providerId = `test.${Buffer.from(PHONE).toString('base64')}`;
  const message = (id = providerId) => ({
    digest: digest(id),
    recipientHash: identity.hash,
    hashKeyId: 'test-v1',
    command: 'STOP' as const,
    providerTimestamp: NOW,
    rawEvent: { command: 'STOP' },
  });
  const accept = (database: PlatformWhatsappDatabase = global, id = providerId) =>
    createWhatsappInboxRepository(database, ids).accept([message(id)], NOW);
  const authorize = testAuthorization(base, identity, ids);
  const waiting = async () => {
    for (let i = 0; i < 100; i++) {
      const rows =
        await owner`SELECT 1 FROM pg_stat_activity WHERE datname=${base.testDb.name} AND wait_event='advisory'`;
      if (rows.length !== 0) return;
    }
    throw new Error('TEST_LOCK_WAITER_MISSING');
  };
  return {
    ...base,
    global,
    owner,
    intake,
    identity,
    message,
    accept,
    authorize,
    waiting,
    freshCheck: (company: string) =>
      base.db.withTenant(company, async (tx) => {
        await tx.execute(sql`SELECT 1`);
        return createSuppressionGate(tx).isSuppressed(identity.hash);
      }),
    close: async () => {
      await global.close();
      await owner.end();
      await intake.end();
      await base.close();
    },
  };
}

function testAuthorization(
  base: Awaited<ReturnType<typeof notificationHarness>>,
  identity: PlatformHarness['identity'],
  ids: ReturnType<typeof systemUuidV7>,
) {
  return async (
    company: string = TENANT.A.company,
    held?: {
      entered: ReturnType<typeof barrier>;
      release: ReturnType<typeof barrier>;
      rollback?: boolean;
    },
    preparedSource?: AuthorizationSource,
  ) => {
    const source = preparedSource ?? (await base.request({}, company));
    await base.db.withTenant(company, async (tx) => {
      const gate = createSuppressionGate(tx);
      const suppression =
        held === undefined
          ? gate
          : {
              isSuppressed: async (hash: Uint8Array) => {
                const result = await gate.isSuppressed(hash);
                held.entered.release();
                await held.release.wait;
                return result;
              },
            };
      await new AuthorizeNotification(
        createAuthorizationRepository(tx),
        suppression,
        base.clock,
        ids,
      ).execute({
        companyId: company,
        sourceEventId: source.id,
        businessId: null,
        branchId: null,
        phone: PHONE,
        identity,
        locale: 'ar',
        channel: 'whatsapp',
        templateKey: 'test_notice',
        templateRevision: 1,
        providerTemplateName: 'test_notice_ar',
        safeParameters: [],
        deadline: null,
        configurationFailure: null,
      });
      if (held?.rollback) throw new Error('TEST_AUTHORIZATION_ROLLBACK');
    });
    return base.attempt(source);
  };
}
