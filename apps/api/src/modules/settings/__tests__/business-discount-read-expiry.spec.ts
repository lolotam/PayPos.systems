import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  newMember,
  newHeldMember,
  permissionFixture,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { readEffectiveDiscountLimit } from '../index.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
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

async function expirySubject(kind: 'owner' | 'target') {
  const expiring = await newMember(f, kind === 'owner' ? 'owner' : 'viewer');
  const [holder] = await f.h.owner`SELECT employee_id FROM memberships
    WHERE company_id=${f.company} AND id=${expiring}`;
  const target =
    kind === 'target'
      ? expiring
      : await newHeldMember(f, {
          employeeId: holder?.['employee_id'] as string,
        });
  await f.h.owner`UPDATE memberships SET limit_bps=500
    WHERE company_id=${f.company} AND id=${target}`;
  return { target, expiring };
}

function readWithOneClock(
  member: string,
  started: ReturnType<typeof barrier>,
  proceed: ReturnType<typeof barrier>,
) {
  return f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SELECT now()`);
    started.release();
    await proceed.promise;
    const samples: string[] = [];
    const proxy = new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const compiled = new PgDialect().sqlToQuery(query);
              const rows = await target.execute(query);
              if (compiled.sql.includes('clock_timestamp()'))
                samples.push((rows[0] as { at: string }).at);
              if (compiled.sql.includes('SELECT m.limit_bps')) {
                expect(compiled.params.filter((value) => value === samples[0])).toHaveLength(4);
              }
              return rows;
            }
          : Reflect.get(target, property, receiver),
    });
    const result = await readEffectiveDiscountLimit(proxy as Tx, f.company, f.business, member);
    expect(samples).toHaveLength(1);
    return result;
  });
}

it.each([
  ['owner', 'company'],
  ['target', 'company'],
  ['owner', 'settings'],
  ['target', 'settings'],
] as const)('expires %s eligibility during a %s read-lock wait', async (kind, lock) => {
  const { target, expiring } = await expirySubject(kind);
  const locked = barrier(),
    started = barrier(),
    proceed = barrier(),
    release = barrier();
  const blocker = f.h.owner.begin(async (write) => {
    if (lock === 'company')
      await write`SELECT id FROM companies
      WHERE id=${f.company} FOR NO KEY UPDATE`;
    else
      await write`SELECT business_id FROM business_settings
      WHERE company_id=${f.company} AND business_id=${f.business} FOR UPDATE`;
    locked.release();
    await release.promise;
  });
  await locked.promise;
  const reading = readWithOneClock(target, started, proceed);
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await started.promise;
    // الجدولة قبل أقفال العضوية تمنع عكس ترتيب الأقفال، ونهاية العضوية تسبق فك القفل فعلًا.
    const [deadline] = await observer`UPDATE memberships
      SET ends_at=clock_timestamp()+interval '1 second'
      WHERE company_id=${f.company} AND id=${expiring} RETURNING ends_at::text AS at`;
    proceed.release();
    await vi.waitFor(
      async () => {
        const rows = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE ${lock === 'company' ? '%companies%FOR SHARE%' : '%business_settings%FOR SHARE%'}`;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
    const [active] =
      await observer`SELECT clock_timestamp()<${deadline?.['at']}::timestamptz AS active`;
    expect(active?.['active']).toBe(true);
    await vi.waitFor(
      async () => {
        const [time] =
          await observer`SELECT clock_timestamp()>=${deadline?.['at']}::timestamptz AS expired`;
        expect(time?.['expired']).toBe(true);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    proceed.release();
    release.release();
    try {
      await blocker;
    } finally {
      await observer.end();
    }
  }
  expect(await reading).toEqual(
    kind === 'owner'
      ? { status: 'SET', source: 'PERSON', limit_bps: 500 }
      : { status: 'MEMBERSHIP_NOT_FOUND' },
  );
});
