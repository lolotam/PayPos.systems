import { measuredAuthorizer } from './access-transaction.fixture.ts';
import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { Require, RequireAny, RequiresFeature } from '../../../shared/access.decorators.ts';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

@Controller('probe/any')
class AnyProbe {
  @RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], {
    branch: 'branchId',
  })
  @Get(':branchId')
  any(): { allowed: boolean } {
    return { allowed: true };
  }

  @RequiresFeature('orders')
  @RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], {
    branch: 'branchId',
  })
  @Get(':branchId/feature')
  feature(): { allowed: boolean } {
    return { allowed: true };
  }

  @Require('read:service-sessions:branch', { branch: 'branchId' })
  @Get(':branchId/single')
  single(): { allowed: boolean } {
    return { allowed: true };
  }
}

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture({ controllers: [AnyProbe] });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember}`;
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company}`;
});

async function grant(
  permission: 'record:service-sessions:branch' | 'read:service-sessions:branch',
  effect: 'ALLOW' | 'DENY' = 'ALLOW',
) {
  await seedOverride(f, f.managerMember, {
    permission_code: permission,
    effect,
    scope_type: 'BRANCH',
    scope_id: f.branch,
  });
}
async function get(suffix = '', branch = f.branch, company = f.company) {
  f.h.calls.tenant.length = 0;
  f.h.calls.user.length = 0;
  return f.h.send('GET', `/v1/probe/any/${branch}${suffix}`, { cookie: f.managerCookie, company });
}

it.each(['record:service-sessions:branch', 'read:service-sessions:branch'] as const)(
  '%s alone allows the branch with one tenant transaction',
  async (permission) => {
    await grant(permission);
    expect(await get()).toMatchObject({ status: 200, body: { allowed: true } });
    expect(f.h.calls.user).toHaveLength(1);
    expect(f.h.calls.tenant).toEqual([f.company]);
  },
);
it('neither permission refuses, and DENY on both defeats covering ALLOWs', async () => {
  expect(await get()).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
  await grant('record:service-sessions:branch', 'DENY');
  await grant('read:service-sessions:branch');
  expect(await get()).toMatchObject({ status: 200 });
  await grant('read:service-sessions:branch', 'DENY');
  expect(await get()).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
});
it.each([
  ['record:service-sessions:branch', 'read:service-sessions:branch'],
  ['read:service-sessions:branch', 'record:service-sessions:branch'],
] as const)('DENY %s does not defeat ALLOW %s', async (denied, allowed) => {
  await grant(denied, 'DENY');
  await grant(allowed);
  expect(await get()).toMatchObject({ status: 200 });
});
it('shares the feature read and keeps permission refusal before feature refusal', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic test',${f.userId})`;
  expect(await get('/feature')).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
  await grant('read:service-sessions:branch');
  expect(await get('/feature')).toMatchObject({ status: 403, body: { code: 'FEATURE_DISABLED' } });
  expect(f.h.calls.tenant).toEqual([f.company]);
  await f.h.owner`UPDATE company_feature_overrides SET enabled=true WHERE company_id=${f.company}`;
  expect(await get('/feature')).toMatchObject({ status: 200 });
  expect(f.h.calls.tenant).toEqual([f.company]);
});
it('#835: permission denial precedes a broken feature query; permitted requests retain infrastructure errors', async () => {
  const [plan] = await f.h.owner`SELECT p.id,p.feature_flags FROM plans p
    JOIN companies c ON c.plan_id=p.id WHERE c.id=${f.company}`;
  if (plan === undefined) throw new Error('Missing synthetic plan');
  const planId = plan['id'] as string;
  const originalFlags = JSON.stringify(plan['feature_flags']);
  try {
    await f.h
      .owner`UPDATE plans SET feature_flags=feature_flags || '{"orders":"broken-feature-test"}'::jsonb
      WHERE id=${planId}`;
    f.h.calls.statements.length = 0;
    expect(await get('/feature')).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(f.h.calls.statements.some(({ sql }) => sql.includes('company_feature_overrides'))).toBe(
      false,
    );
    expect(f.h.calls.tenant).toEqual([f.company]);
    await grant('read:service-sessions:branch');
    expect(await get('/feature')).toMatchObject({ status: 500, body: { code: 'INTERNAL_ERROR' } });
    expect(f.h.calls.tenant).toEqual([f.company]);
  } finally {
    await f.h.owner`UPDATE plans SET feature_flags=${originalFlags}::jsonb WHERE id=${planId}`;
  }
});
it('single permission and unknown/foreign/malformed targets preserve refusal semantics', async () => {
  await grant('record:service-sessions:branch');
  expect(await get('/single')).toMatchObject({ status: 403 });
  await grant('read:service-sessions:branch');
  expect(await get('/single')).toMatchObject({ status: 200 });
  expect(f.h.calls.tenant).toEqual([f.company]);
  for (const branch of [f.foreignBranch, f.ids.newId(), 'invalid']) {
    expect(await get('', branch)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
  }
  expect(f.h.calls.tenant).toEqual([]);
});

it.each(['company', 'business', 'branch', 'membership', 'batch'] as const)(
  '%s target and grants share the same user-bound transaction without overlap',
  async (kind) => {
    const { authorizer, trace } = measuredAuthorizer(f.db);
    const input = {
      userId: f.userId,
      requestedCompany: f.company,
      permission: 'read:service-sessions:branch',
    };
    if (kind === 'batch') {
      const allowed = await authorizer.executeBranches({
        ...input,
        branchParams: [f.branch, f.siblingBranch],
      });
      expect([...allowed.values()]).toEqual([true, true]);
    } else {
      const target =
        kind === 'branch'
          ? { branchParam: f.branch }
          : kind === 'business'
            ? { businessParam: f.business }
            : kind === 'membership'
              ? { membershipParam: f.ownMember }
              : {};
      expect(
        await authorizer.execute({ ...input, ...target, featureFlag: 'orders' }),
      ).not.toBeNull();
    }
    expect(trace.events).toEqual(['user:enter', 'user:exit', 'tenant:enter', 'tenant:exit']);
    expect(trace.maximum).toBe(1);
    expect(trace.active).toBe(0);
    expect(trace.tenants).toHaveLength(1);
    expect(trace.tenants[0]).toMatchObject({ companyId: f.company, userId: f.userId });
    expect(new Set(trace.reads.map((read) => read.tx))).toEqual(
      new Set(trace.tenants.map((entry) => entry.tx)),
    );
    expect(trace.reads.some((read) => read.sql.includes('role_permissions'))).toBe(true);
    if (kind !== 'batch')
      expect(trace.reads.some((read) => read.sql.includes('company_feature_overrides'))).toBe(true);
  },
);
it('non-member company is refused before entering a tenant', async () => {
  const { authorizer, trace } = measuredAuthorizer(f.db);
  expect(
    await authorizer.execute({
      userId: f.managerId,
      requestedCompany: f.otherCompany,
      permission: ['record:service-sessions:branch', 'read:service-sessions:branch'],
      branchParam: f.foreignBranch,
    }),
  ).toBeNull();
  expect(trace.tenants).toEqual([]);
  expect(trace.events).toEqual(['user:enter', 'user:exit']);
});
