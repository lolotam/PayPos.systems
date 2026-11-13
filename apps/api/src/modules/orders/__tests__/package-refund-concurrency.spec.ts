import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ids } from './session.fixture.ts';
import { packageLine } from './package-redemption.fixture.ts';
import {
  packageRefundFixture,
  postRefund,
  readRefunds,
  refundBody,
  seedSoldPackage,
  seedTwoComponentPackage,
  type PackageRefundFixture,
} from './package-refund.fixture.ts';

let fx: PackageRefundFixture;

beforeAll(async () => {
  fx = await packageRefundFixture();
});

afterAll(async () => {
  await fx?.f.close();
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('RF-03 lets exactly one of a refund and a redemption of the last free session win', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f, { sessions: 1 });
  const [refund, redemption] = await Promise.allSettled([
    postRefund(f, fresh.entitlement, {
      body: refundBody({ component_id: fresh.component, sessions: 1 }),
    }),
    f.create.execute({
      ...f.context(ids.newId()),
      input: f.body([packageLine(f, fresh.entitlement)]),
    }),
  ]);
  if (refund === undefined || redemption === undefined) throw new Error('Expected two outcomes');
  const refundResponse = refund.status === 'fulfilled' ? refund.value : undefined;
  const refunded = refundResponse?.status === 201;
  const redeemed = redemption.status === 'fulfilled';
  expect(refunded).toBe(!redeemed);
  if (!refunded && refundResponse !== undefined) {
    expect(refundResponse).toMatchObject({
      status: 422,
      body: { code: 'INSUFFICIENT_SLOTS' },
    });
  }
  if (redemption.status === 'rejected') {
    expect(redemption.reason).toMatchObject({ code: 'PACKAGE_NO_FREE_SESSION' });
  }
  const refunds = await readRefunds(f, fresh.entitlement);
  const [entitlement] = await f.h.owner`SELECT refunded_amount::text AS refunded_amount, revision
    FROM package_entitlements WHERE id=${fresh.entitlement}`;
  if (refunded) {
    expect(refunds).toHaveLength(1);
    expect(entitlement).toEqual({ refunded_amount: '2.250', revision: 2 });
  } else {
    expect(refunds).toHaveLength(0);
    expect(entitlement).toEqual({ refunded_amount: '0.000', revision: 1 });
  }
});

it('RF-04 serialises two refunds of different components and lands the revision two steps ahead', async () => {
  const { f } = fx;
  const seeded = await seedTwoComponentPackage(f, { sessions: 2 });
  const first = seeded.components[0];
  const second = seeded.components[1];
  if (first === undefined || second === undefined) throw new Error('Expected two components');
  const results = await Promise.allSettled([
    postRefund(f, seeded.entitlement, {
      body: refundBody({ component_id: first, sessions: 1 }),
    }),
    postRefund(f, seeded.entitlement, {
      body: refundBody({ component_id: second, sessions: 1 }),
    }),
  ]);
  expect(
    results.map((result) => (result.status === 'fulfilled' ? result.value.status : 0)),
  ).toEqual([201, 201]);
  const [entitlement] = await f.h.owner`SELECT refunded_amount::text AS refunded_amount, revision
    FROM package_entitlements WHERE id=${seeded.entitlement}`;
  expect(entitlement).toEqual({ refunded_amount: '4.500', revision: 3 });
  expect(await readRefunds(f, seeded.entitlement)).toHaveLength(2);
});

it('waits for the entitlement lock and writes nothing until it is released', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f, { sessions: 2 });
  const locked = barrier();
  const release = barrier();
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const holding = blocker.begin(async (write) => {
    await write`SELECT id FROM package_components WHERE id=${fresh.component} FOR UPDATE`;
    await write`SELECT id FROM package_entitlements WHERE id=${fresh.entitlement} FOR UPDATE`;
    locked.release();
    await release.promise;
  });
  let pending: Promise<Awaited<ReturnType<typeof postRefund>>> | undefined;
  try {
    await locked.promise;
    pending = postRefund(f, fresh.entitlement, {
      body: refundBody({ component_id: fresh.component, sessions: 1 }),
    });
    await vi.waitFor(async () => {
      const waiting = await observer`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%package_entitlements%'`;
      expect(waiting.length).toBeGreaterThan(0);
    });
    expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
    release.release();
    await holding;
    expect((await pending).status).toBe(201);
  } finally {
    release.release();
    await holding;
    await pending?.catch(() => undefined);
    await observer.end();
    await blocker.end();
  }
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(1);
});
