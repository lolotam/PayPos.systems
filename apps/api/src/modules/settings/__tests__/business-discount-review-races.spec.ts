import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  newMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { SETTINGS_TEMPLATE } from '../domain/business-settings.ts';
import { readEffectiveDiscountLimit } from '../index.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';
import { UpdateBusinessSettings } from '../use-cases/update-business-settings/update-business-settings.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  await seedOverride(f, f.managerMember, { permission_code: 'manage:settings:business' });
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, limit_bps)
    VALUES (${f.company}, ${f.business}, 0)`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function waitForLock(observer: ReturnType<typeof postgres>, query: string) {
  await vi.waitFor(
    async () => {
      const rows = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE ${query}`;
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 20 },
  );
}

function pausedGenericPatch(
  locked: ReturnType<typeof barrier>,
  release: ReturnType<typeof barrier>,
) {
  const transactions = createSettingsTransactions(f.db, f.ids);
  return new UpdateBusinessSettings(
    {
      run: (companyId, userId, work) =>
        transactions.run(companyId, userId, (scope) =>
          work({
            ...scope,
            findForUpdate: async (businessId) => {
              const before = await scope.findForUpdate(businessId);
              locked.release();
              await release.promise;
              return before;
            },
          }),
        ),
    },
    { invalidate: async () => undefined },
    SETTINGS_TEMPLATE,
  ).execute({
    companyId: f.company,
    userId: f.managerId,
    businessId: f.business,
    change: { calendar: 'hijri' },
  });
}

it.each([true, false])(
  'rechecks authority and audit time after generic PATCH lock wait (expires=%s)',
  async (expires) => {
    await f.h.owner`UPDATE permission_overrides SET expires_at=clock_timestamp()
    WHERE company_id=${f.company} AND membership_id=${f.managerMember}
    AND permission_code='manage:discounts:company'`;
    const grant = await seedOverride(f, f.managerMember, {
      permission_code: 'manage:discounts:company',
    });
    const locked = barrier(),
      release = barrier();
    const patch = pausedGenericPatch(locked, release);
    await locked.promise;
    const request = f.h.send('POST', `/v1/businesses/${f.business}/settings/discount-limit`, {
      cookie: f.managerCookie,
      company: f.company,
      body: { limit_bps: 500, reason: 'Synthetic settings lock race' },
    });
    const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
    let releasedAt: string | undefined;
    try {
      await waitForLock(observer, '%business_settings%');
      if (expires)
        await observer`UPDATE permission_overrides SET expires_at=clock_timestamp()
      WHERE company_id=${f.company} AND id=${grant}`;
      const [time] = await observer`SELECT clock_timestamp()::text AS time`;
      releasedAt = time?.['time'] as string;
    } finally {
      release.release();
      await patch;
      await observer.end();
    }
    const response = await request;
    expect(response.status).toBe(expires ? 403 : 200);
    if (expires) expect(response.body['code']).toBe('PERMISSION_NOT_HELD');
    const [settings] = await f.h.owner`SELECT calendar, limit_bps FROM business_settings
    WHERE company_id=${f.company} AND business_id=${f.business}`;
    expect(settings).toMatchObject({ calendar: 'hijri', limit_bps: expires ? 0 : 500 });
    const audits = await f.h.owner`SELECT after->>'decided_at' AS decided_at FROM audit_log
    WHERE company_id=${f.company} AND entity='business_discount_limit'`;
    expect(audits).toHaveLength(expires ? 0 : 1);
    if (!expires)
      expect(new Date(audits[0]?.['decided_at'] as string).getTime()).toBeGreaterThanOrEqual(
        new Date(releasedAt ?? '').getTime(),
      );
  },
);

async function expectReadCommitted(tx: Tx) {
  const [isolation] = await tx.execute<{ isolation: string }>(
    sql`SELECT current_setting('transaction_isolation') AS isolation`,
  );
  expect(isolation?.isolation).toBe('read committed');
}

it('keeps a READ COMMITTED resolution coherent during personal null→0 and default 0→10000', async () => {
  const member = await newMember(f);
  await f.h.owner`UPDATE business_settings SET limit_bps=0
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let writer: Promise<unknown> | undefined,
    committed = false;
  try {
    const result = await f.db.withTenant(f.company, async (tx) => {
      await expectReadCommitted(tx);
      const proxy = new Proxy(tx, {
        get: (target, property, receiver) =>
          property === 'execute'
            ? async (query: SQL) => {
                const rows = await target.execute(query);
                if (
                  writer === undefined &&
                  new PgDialect().sqlToQuery(query).sql.includes('SELECT m.limit_bps')
                ) {
                  // بنغيّر المصدرين بين القراءتين القديمة؛ الأقفال الجديدة توقف الكاتب لحد انتهاء القراءة.
                  writer = f.h.owner
                    .begin(async (write) => {
                      await write`UPDATE memberships SET limit_bps=0 WHERE company_id=${f.company} AND id=${member}`;
                      await write`UPDATE business_settings SET limit_bps=10000
                  WHERE company_id=${f.company} AND business_id=${f.business}`;
                    })
                    .then(() => {
                      committed = true;
                    });
                  await vi.waitFor(
                    async () => {
                      const waiting =
                        await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                  AND wait_event_type='Lock' AND query LIKE '%UPDATE memberships SET limit_bps%'`;
                      expect(committed || waiting.length > 0).toBe(true);
                    },
                    { timeout: 5000, interval: 20 },
                  );
                }
                return rows;
              }
            : Reflect.get(target, property, receiver),
      });
      return readEffectiveDiscountLimit(proxy as Tx, f.company, f.business, member);
    });
    expect(writer).toBeDefined();
    expect(result).toEqual({ status: 'SET', source: 'BUSINESS', limit_bps: 0 });
  } finally {
    await writer;
    await observer.end();
  }
  expect(
    await f.db.withTenant(f.company, (tx) =>
      readEffectiveDiscountLimit(tx, f.company, f.business, member),
    ),
  ).toEqual({ status: 'SET', source: 'PERSON', limit_bps: 0 });
  const [settings] = await f.h.owner`SELECT limit_bps FROM business_settings
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(settings?.['limit_bps']).toBe(10000);
});
