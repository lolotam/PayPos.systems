import { SYSTEM_ROLES } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  newHeldMember,
  permissionFixture,
  save,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
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

it('waits for a sibling role change and protects the newly committed owner before writing a DENY', async () => {
  const member = await newHeldMember(f, { userId: f.managerId });
  const role = SYSTEM_ROLES.find((r) => r.code === 'owner')?.id;
  if (role === undefined) throw new Error('Synthetic owner role missing');
  const locked = barrier(),
    release = barrier();
  const promotion = f.h.owner.begin(async (tx) => {
    await tx`UPDATE memberships SET role_id = ${role}
      WHERE company_id = ${f.company} AND id = ${f.managerMember}`;
    locked.release();
    await release.promise;
  });
  await locked.promise;
  const request = save(f, member, {
    permission_code: 'manage:memberships:company',
    effect: 'DENY',
  });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waiting = await observer`SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%memberships%FOR UPDATE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      },
      { timeout: 5_000, interval: 20 },
    );
  } finally {
    release.release();
    await promotion;
    await observer.end();
  }
  const result = await request;
  expect(result.status).toBe(403);
  expect(result.body['code']).toBe('PERMISSION_OWNER_PROTECTED');
  const overrides = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id = ${f.company} AND membership_id = ${member}`;
  expect(overrides).toEqual([]);
});
