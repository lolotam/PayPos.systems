import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { documentExpiryTransactions } from '../persistence/document-expiry.transactions.ts';
import {
  documentExpiryFixture,
  type DocumentExpiryFixture,
  type Tenant,
} from './document-expiry.fixture.ts';

let f: DocumentExpiryFixture;
beforeAll(async () => {
  f = await documentExpiryFixture();
});
afterAll(async () => {
  await f?.close();
});

async function candidate(tenant: Tenant) {
  const [row] = await f.transactions.candidates(
    tenant.company,
    tenant.business,
    'Asia/Kuwait',
    f.clock.now(),
    null,
    100,
  );
  if (row === undefined) throw new Error('SYNTHETIC_CANDIDATE_MISSING');
  return row;
}

async function totals(document: string) {
  const [row] = await f.owner`SELECT
    (SELECT count(*)::int FROM employee_document_expiry_notices WHERE document_id=${document}) AS ledger,
    (SELECT count(*)::int FROM audit_log WHERE entity_id=${document} AND action='document_expiring.notified') AS audit,
    (SELECT count(*)::int FROM outbox WHERE event_type='DocumentExpiring' AND payload->>'document_id'=${document}) AS events`;
  return row;
}

async function setup() {
  const tenant = await f.tenant();
  await f.type(tenant, 'passport', 30);
  const employee = await f.employee(tenant);
  const document = await f.document(tenant, employee, 'passport', '2026-10-20');
  return { tenant, employee, document, row: await candidate(tenant) };
}

it('two workers and a restarted worker commit only one ledger, audit and event', async () => {
  const { tenant, document, row } = await setup();
  const results = await Promise.all([
    f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now()),
    documentExpiryTransactions(f.db, f.ids).notify(
      tenant.company,
      row,
      '2026-10-05',
      f.clock.now(),
    ),
  ]);
  expect(results.sort()).toEqual([false, true]);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await totals(document)).toEqual({ ledger: 1, audit: 1, events: 1 });
});

it('a replacement committed after paging invalidates the old candidate', async () => {
  const { tenant, employee, document, row } = await setup();
  const replacement = await f.replace(tenant, employee, 'passport', document, '2026-10-20');
  expect(await f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now())).toBe(false);
  expect(await totals(document)).toEqual({ ledger: 0, audit: 0, events: 0 });
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await totals(replacement)).toEqual({ ledger: 1, audit: 1, events: 1 });
});

it('rechecks edited alert_days and uses the fresh rule in the event', async () => {
  const { tenant, document, row } = await setup();
  await f.setAlertDays(tenant, 'passport', 0);
  expect(await f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now())).toBe(false);
  expect(await totals(document)).toEqual({ ledger: 0, audit: 0, events: 0 });
  await f.setAlertDays(tenant, 'passport', 20);
  expect(await f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now())).toBe(true);
  const [event] =
    await f.owner`SELECT payload FROM outbox WHERE event_type='DocumentExpiring' AND payload->>'document_id'=${document}`;
  expect(event?.['payload']).toMatchObject({ alert_days: 20 });
});

it('rollback after ledger, audit and outbox writes leaves all three empty and retry wins once', async () => {
  const { tenant, document, row } = await setup();
  const failing = documentExpiryTransactions(
    {
      withTenant: (company, work, options) =>
        f.db.withTenant(
          company,
          async (tx) => {
            await work(tx);
            throw new Error('SYNTHETIC_ROLLBACK');
          },
          options,
        ),
    },
    f.ids,
  );
  await expect(failing.notify(tenant.company, row, '2026-10-05', f.clock.now())).rejects.toThrow(
    'SYNTHETIC_ROLLBACK',
  );
  expect(await totals(document)).toEqual({ ledger: 0, audit: 0, events: 0 });
  expect(await f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now())).toBe(true);
  expect(await totals(document)).toEqual({ ledger: 1, audit: 1, events: 1 });
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

it.each(['replacement', 'rule edit'])(
  'an emission holding the locks commits before a waiting %s',
  async (change) => {
    const { tenant, document, row } = await setup();
    const locked = gate(),
      release = gate();
    const guarded = documentExpiryTransactions(
      {
        withTenant: (company, work, options) =>
          f.db.withTenant(
            company,
            async (tx) => {
              const result = await work(tx);
              locked.open();
              await release.promise;
              return result;
            },
            options,
          ),
      },
      f.ids,
    );
    const notice = guarded.notify(tenant.company, row, '2026-10-05', f.clock.now());
    await locked.promise;
    const edit = f.db.withTenant(tenant.company, (tx) =>
      tx.execute(
        change === 'replacement'
          ? sql`UPDATE employee_documents SET replaced_at=now() WHERE company_id=${tenant.company} AND id=${document}`
          : sql`UPDATE document_types SET alert_days=0 WHERE company_id=${tenant.company} AND code='passport'`,
      ),
    );
    try {
      await vi.waitFor(async () => {
        const [waiter] = await f.owner`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND usename='pospay_app' AND wait_event_type='Lock'`;
        expect(waiter?.['n']).toBeGreaterThan(0);
      });
    } finally {
      release.open();
    }
    expect(await notice).toBe(true);
    await edit;
    expect(await totals(document)).toEqual({ ledger: 1, audit: 1, events: 1 });
  },
);

it('waits for an in-flight replacement and rejects its stale candidate after commit', async () => {
  const { tenant, document, row } = await setup();
  const locked = gate(),
    release = gate();
  const replacement = f.owner.begin(async (tx) => {
    await tx`UPDATE employee_documents SET replaced_at=now() WHERE company_id=${tenant.company} AND id=${document}`;
    locked.open();
    await release.promise;
  });
  await locked.promise;
  const notice = f.transactions.notify(tenant.company, row, '2026-10-05', f.clock.now());
  try {
    await vi.waitFor(async () => {
      const [waiter] = await f.owner`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND usename='pospay_app' AND wait_event_type='Lock'`;
      expect(waiter?.['n']).toBeGreaterThan(0);
    });
  } finally {
    release.open();
  }
  await replacement;
  expect(await notice).toBe(false);
  expect(await totals(document)).toEqual({ ledger: 0, audit: 0, events: 0 });
});
