import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase, type Database, type IdGenerator } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createTenancyTransactions } from '../persistence/tenancy-transactions.ts';
import type { TenancyTransactions } from '../ports/tenancy-transactions.port.ts';
import { SetBusinessCountry } from '../use-cases/set-business-country/set-business-country.ts';

// The transaction side of the country change, on a real Postgres in a database of its own: the row
// lock orders two concurrent changes and chains their audit rows, and a failing audit rolls the
// country write back with it.

let h: Harness;
let db: Database;
let ids: IdGenerator;
let owner: string;
let company: string;
let business: string;
let userId: string;

beforeAll(async () => {
  h = await startHarness();
  ids = systemUuidV7();
  db = createDatabase({ url: h.urls.app, ids });
  owner = await h.signedInOperator('country-transactions@example.test');
  company = await h.onboard(owner, 'Country Transactions');
  const created = await h.send('POST', '/v1/businesses', {
    cookie: owner,
    company,
    key: 'country-tx-business',
    body: { vertical_type: 'salon', name_en: 'Contention business' },
  });
  business = created.body['id'] as string;
  const [user] =
    await h.owner`SELECT id FROM "user" WHERE email = 'country-transactions@example.test'`;
  userId = user?.['id'] as string;
});

afterAll(async () => {
  // The harness drops the database it cloned for this file, so the test company and its business
  // go with it; the extra pool is closed first.
  await db?.close();
  await h?.close();
});

const put = (body: object) =>
  h.send('PUT', `/v1/businesses/${business}/country`, { cookie: owner, company, body });

const settingsOf = async (): Promise<Record<string, unknown>> => {
  const [row] =
    await h.owner`SELECT settings FROM businesses WHERE company_id = ${company} AND id = ${business}`;
  return (row?.['settings'] ?? {}) as Record<string, unknown>;
};

const countryAudits = async () =>
  h.owner`SELECT before, after FROM audit_log
    WHERE company_id = ${company} AND entity = 'business' AND entity_id = ${business}
      AND action = 'country.changed' ORDER BY id`;

/**
 * The outcome of one country request once it settles: the answer it gave, or the failure that
 * stopped it.
 */
type SettledUpdate =
  | { readonly kind: 'answered'; readonly status: number; readonly body: Record<string, unknown> }
  | { readonly kind: 'failed'; readonly error: unknown };

const isAnswered = (
  outcome: SettledUpdate,
): outcome is Extract<SettledUpdate, { kind: 'answered' }> => outcome.kind === 'answered';

const describeOutcome = (outcome: SettledUpdate): string =>
  isAnswered(outcome) ? `answered ${outcome.status}` : `failed with ${String(outcome.error)}`;

/**
 * كل طلب ياخد handler بتاعه من أول لحظة: فشل مبكر ميبقاش rejection متسابة، وبيطلع وأنا لسه
 * ماسك قفل الصف مش بعد ما القفل يتحل.
 */
function watchUpdate(
  request: Promise<{ status: number; body: Record<string, unknown> }>,
  onSettled: (outcome: SettledUpdate) => void,
): Promise<SettledUpdate> {
  return request.then(
    (response) => {
      const outcome: SettledUpdate = {
        kind: 'answered',
        status: response.status,
        body: response.body,
      };
      onSettled(outcome);
      return outcome;
    },
    (error: unknown) => {
      const outcome: SettledUpdate = { kind: 'failed', error };
      onSettled(outcome);
      return outcome;
    },
  );
}

/** What the contention looks like while the row is still held. */
interface Contention {
  bothWaiting: boolean;
  earlyFailure?: Error;
}

// The real Postgres overlap: both updates are queued on the row lock while the holder keeps it, and
// at least one of them is queued behind that holder.
const updatesWaitingOnRow = async (observer: postgres.Sql, holderPid: number) =>
  observer<{ behindHolder: boolean }[]>`
    SELECT ${holderPid} = ANY(pg_blocking_pids(pid)) AS "behindHolder"
    FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND query LIKE '%FROM businesses%FOR NO KEY UPDATE%'`;

/**
 * ينتظر لحد ما الطلبين يقفوا فعلاً على قفل الصف، ويفشل بسرعة لو أي طلب اتقفل قبل كده: يا إما
 * قفل الصف مالوش معنى، يا إما الطلب ده فشل قبل ما يوصل للقفل أصلاً.
 */
async function waitForTwoUpdatesWaitingOnRow(
  observer: postgres.Sql,
  holderPid: number,
  contention: Contention,
): Promise<{ behindHolder: boolean }[]> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    if (contention.earlyFailure !== undefined) throw contention.earlyFailure;
    const waiting = await updatesWaitingOnRow(observer, holderPid);
    if (waiting.length === 2 && waiting.some(({ behindHolder }) => behindHolder)) return waiting;
    if (Date.now() >= deadline) return waiting;
    await delay(20);
  }
}

/** The row lock the two updates have to queue behind. */
async function holdBusinessRowLock(holder: postgres.TransactionSql): Promise<number> {
  const [row] = await holder<{ pid: number }[]>`
    SELECT pg_backend_pid() AS pid FROM businesses
    WHERE company_id = ${company} AND id = ${business} FOR NO KEY UPDATE`;
  if (!row) throw new Error('Missing synthetic business for contention test');
  return row.pid;
}

/**
 * الطلبان بينطلقوا دلوقتي، وhandler لكل واحد متركّب من أول لحظة: أي فشل مبكر لازم يطلع وأنا
 * لسه ماسك قفل الصف، مش بعد ما القفل يتحل.
 */
function startCountryUpdates(contention: Contention): Promise<SettledUpdate>[] {
  return ['KW', 'QA'].map((country) =>
    watchUpdate(put({ country }), (outcome) => {
      if (contention.bothWaiting) return;
      contention.earlyFailure ??= new Error(
        `A country update settled before both updates waited on the row lock: ${describeOutcome(outcome)}`,
      );
    }),
  );
}

/**
 * يطلب تغييرين متزامنين على نفس صف النشاط: معاملة بأخرى ماسكة القفل، والاتنين بيقفوا وراها.
 */
async function updateCountriesWaitingOnOneRow(): Promise<SettledUpdate[]> {
  const observer = postgres(h.ownerUrl, { max: 1, onnotice: () => undefined });
  const contention: Contention = { bothWaiting: false };
  let settled: Promise<SettledUpdate>[] = [];
  try {
    await h.owner.begin(async (holder) => {
      const holderPid = await holdBusinessRowLock(holder);
      settled = startCountryUpdates(contention);
      const waiting = await waitForTwoUpdatesWaitingOnRow(observer, holderPid, contention);
      expect(waiting).toHaveLength(2);
      expect(waiting.some(({ behindHolder }) => behindHolder)).toBe(true);
      contention.bothWaiting = true;
    });
    return await Promise.all(settled);
  } finally {
    // The held row is released by the transaction itself (commit or rollback); the observer closes
    // with a deadline, and the two requests are drained before the file moves on.
    await Promise.allSettled(settled);
    await observer.end({ timeout: 5 });
  }
}

describe('concurrent changes ordering (FOR NO KEY UPDATE)', () => {
  it('orders two concurrent changes so the later audit continues from the earlier audit value', async () => {
    const before = await settingsOf();
    const auditCount = (await countryAudits()).length;
    const outcomes = await updateCountriesWaitingOnOneRow();

    // كل طلب اتقفل بنتيجة معلومة: مفيش rejection ضايعة، ومفيش طلب اتقفل قبل ما الاتنين يقفوا على القفل.
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['answered', 'answered']);
    expect(outcomes.filter(isAnswered).map((outcome) => outcome.status)).toEqual([200, 200]);

    const stored = (await settingsOf())['country'];
    expect(['KW', 'QA']).toContain(stored);
    const earlier = stored === 'KW' ? 'QA' : 'KW';
    expect((await countryAudits()).slice(auditCount)).toEqual([
      { before: { country: before['country'] ?? null }, after: { country: earlier } },
      { before: { country: earlier }, after: { country: stored } },
    ]);
  });
});

describe('audit-failure rollback (BD-05 pattern)', () => {
  it('rolls the country write back and records no audit row when the audit fails', async () => {
    const before = await settingsOf();
    const auditCount = (await countryAudits()).length;
    const stored = typeof before['country'] === 'string' ? before['country'] : null;
    // الدولة المطلوبة مضمونة الاختلاف عن المخزّن، فالتغيير فعلي والكتابة والفشل بيحصلوا بالضرورة.
    const requested = stored === 'KW' ? 'QA' : 'KW';
    const real = createTenancyTransactions(db, ids);
    const transactions: TenancyTransactions = {
      run: (context, idempotency, work) => real.run(context, idempotency, work),
      runBusinessCountryChange: (context, work) =>
        real.runBusinessCountryChange(context, (scope) =>
          work({
            ...scope,
            audit: {
              record: async () => {
                throw new Error('Synthetic audit failure');
              },
            },
          }),
        ),
    };
    const useCase = new SetBusinessCountry(transactions);
    await expect(
      useCase.execute({
        companyId: company,
        userId,
        businessId: business,
        country: requested,
      }),
    ).rejects.toThrow('Synthetic audit failure');
    expect(await settingsOf()).toEqual(before);
    expect(await countryAudits()).toHaveLength(auditCount);
  });
});
