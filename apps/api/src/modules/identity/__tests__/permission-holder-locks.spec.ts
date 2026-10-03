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

async function waitForMembershipLock(observer: ReturnType<typeof postgres>) {
  await vi.waitFor(
    async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%memberships%FOR UPDATE%'`;
      expect(waiting.length).toBeGreaterThan(0);
    },
    { timeout: 5_000, interval: 20 },
  );
}

it.each([
  { audited: false, roleCode: 'owner', status: 403 },
  { audited: true, roleCode: 'owner', status: 403 },
  { audited: true, roleCode: 'viewer', status: 201 },
])(
  'finishes concurrent membership and permission changes (audited=$audited, role=$roleCode)',
  async ({ audited, roleCode, status }) => {
    const member = await newHeldMember(f, { userId: f.managerId });
    const role = SYSTEM_ROLES.find((r) => r.code === roleCode)?.id;
    if (role === undefined) throw new Error('Synthetic role missing');
    const locked = barrier(),
      release = barrier();
    const auditId = f.ids.newId();
    const promotion = f.h.owner.begin(async (tx) => {
      await tx`UPDATE memberships SET role_id = ${role}
      WHERE company_id = ${f.company} AND id = ${f.managerMember}`;
      locked.release();
      await release.promise;
      if (audited)
        await tx`INSERT INTO audit_log
      (company_id, id, actor_user_id, entity, entity_id, action)
      VALUES (${f.company}, ${auditId}, ${f.userId}, 'membership', ${f.managerMember}, 'role.changed')`;
    });
    await locked.promise;
    const request = save(f, member, {
      permission_code: 'manage:memberships:company',
      effect: 'DENY',
    });
    const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      await waitForMembershipLock(observer);
    } finally {
      release.release();
      try {
        await promotion;
      } finally {
        await observer.end();
      }
    }
    const result = await request;
    expect(result.status).toBe(status);
    if (status === 403) expect(result.body['code']).toBe('PERMISSION_OWNER_PROTECTED');
    const overrides = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id = ${f.company} AND membership_id = ${member}`;
    expect(overrides).toHaveLength(status === 201 ? 1 : 0);
    const audits = await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND id=${auditId}`;
    expect(audits).toHaveLength(audited ? 1 : 0);
  },
);
