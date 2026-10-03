import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
  await seedOverride(f, f.managerMember, { permission_code: 'manage:settings:business' });
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

it.each(['authority', 'business lock authority', 'closed company'] as const)(
  'BD-03 rechecks %s after a lock wait',
  async (variant) => {
    const permission = await seedOverride(f, f.managerMember, {
      permission_code: 'manage:discounts:company',
    });
    const locked = barrier(),
      release = barrier();
    const blocker = f.h.owner.begin(async (tx) => {
      if (variant === 'business lock authority') {
        await tx`SELECT id FROM businesses WHERE company_id=${f.company} AND id=${f.business} FOR UPDATE`;
      } else {
        await tx`SELECT id FROM companies WHERE id=${f.company} FOR NO KEY UPDATE`;
      }
      locked.release();
      await release.promise;
      if (variant !== 'closed company') {
        await tx`UPDATE permission_overrides SET expires_at=clock_timestamp() WHERE company_id=${f.company} AND id=${permission}`;
      } else {
        await tx`UPDATE companies SET deleted_at=clock_timestamp() WHERE id=${f.company}`;
      }
    });
    await locked.promise;
    const request = f.h.send('POST', `/v1/businesses/${f.business}/settings/discount-limit`, {
      cookie: f.managerCookie,
      company: f.company,
      body: { limit_bps: 500, reason: 'Synthetic lock race' },
    });
    const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      await vi.waitFor(
        async () => {
          const rows =
            await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE ${variant === 'business lock authority' ? '%businesses%FOR SHARE%' : '%companies%FOR NO KEY UPDATE%'}`;
          expect(rows.length).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      release.release();
      try {
        await blocker;
      } finally {
        await observer.end();
      }
    }
    const response = await request;
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe(
      variant !== 'closed company' ? 'PERMISSION_NOT_HELD' : 'FORBIDDEN',
    );
    expect(
      await f.h
        .owner`SELECT business_id FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`,
    ).toHaveLength(0);
    expect(
      await f.h
        .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity='business_discount_limit'`,
    ).toHaveLength(0);
  },
);
