import { afterAll, beforeAll, expect, it } from 'vitest';

import { mergeGrantConstraints } from '../domain/access.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { permissionFixture, type PermissionFixture } from './permissions-screen.fixture.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
  await seedConstrainedRoles(f);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function seedConstrainedRoles(fixture: PermissionFixture): Promise<void> {
  const [editor] = await fixture.h.owner`
    SELECT id FROM roles WHERE company_id = ${fixture.company} AND code = 'synthetic_editor'`;
  const editorRole = editor?.['id'] as string;
  const branchRole = fixture.ids.newId();
  const branchMember = fixture.ids.newId();
  await fixture.h.owner`INSERT INTO roles(id, company_id, code, name_en)
    VALUES (${branchRole}, ${fixture.company}, 'synthetic_branch_approver', 'Synthetic branch approver')`;
  await fixture.h
    .owner`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${fixture.company}, ${branchMember}, ${fixture.managerId}, ${branchRole}, ${fixture.company}, 'BRANCH', ${fixture.branch})`;
  await fixture.h
    .owner`INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code, constraints)
    VALUES
      (${editorRole}, ${fixture.company}, ${fixture.company}, 'approve:discounts:branch', '{"max_pct":15,"max_amount":500000,"manual_edit":true}'::jsonb),
      (${editorRole}, ${fixture.company}, ${fixture.company}, 'read:branches:branch', '{}'::jsonb),
      (${branchRole}, ${fixture.company}, ${fixture.company}, 'approve:discounts:branch', '{"max_pct":10,"manual_edit":false}'::jsonb)`;
}

it('readAccessTransaction carries role_permissions.constraints, omits {} and merges most-restrictive-wins (#10)', async () => {
  const inspected = await createAccessReader(f.db).accessAt(
    f.company,
    f.managerId,
    { kind: 'branch', branchId: f.branch },
    { allows: () => true },
  );
  expect(inspected).not.toBeNull();
  if (inspected === null) return;
  const discountGrants = inspected.access.grants.filter(
    (g) => g.permission === 'approve:discounts:branch',
  );
  expect(discountGrants).toHaveLength(2);
  expect(discountGrants).toContainEqual(
    expect.objectContaining({
      scopeType: 'COMPANY',
      scopeId: f.company,
      constraints: { max_pct: 15, max_amount: 500000n, manual_edit: true },
    }),
  );
  expect(discountGrants).toContainEqual(
    expect.objectContaining({
      scopeType: 'BRANCH',
      scopeId: f.branch,
      constraints: { max_pct: 10, manual_edit: false },
    }),
  );
  const readBranchGrant = inspected.access.grants.find(
    (g) => g.permission === 'read:branches:branch',
  );
  expect(readBranchGrant && 'constraints' in readBranchGrant).toBe(false);
  expect(
    mergeGrantConstraints(
      inspected.access.grants,
      'approve:discounts:branch',
      inspected.targets.target,
    ),
  ).toEqual({ max_pct: 10, max_amount: 500000n, manual_edit: false });
});

it('preserves exact decimal-scale integers and rejects fractional or out-of-range JSONB constraints independently (#10)', async () => {
  const isolatedUser = await f.h.auth.provisionUser({
    email: 'fractional-grant@synthetic.invalid',
    name: 'Synthetic fractional grant',
    password: `${f.ids.newId()}${f.ids.newId()}`,
  });
  const roleId = f.ids.newId();
  const memberId = f.ids.newId();
  await f.h.owner`INSERT INTO roles(id, company_id, code, name_en)
    VALUES (${roleId}, ${f.company}, 'synthetic_decimal_check', 'Synthetic decimal check')`;
  await f.h
    .owner`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${f.company}, ${memberId}, ${isolatedUser}, ${roleId}, ${f.company}, 'BRANCH', ${f.branch})`;
  await f.h
    .owner`INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code, constraints)
    VALUES
      (${roleId}, ${f.company}, ${f.company}, 'approve:discounts:branch', '{"max_amount":1000.0,"backdate_days":3.0,"max_pct":100.0}'::jsonb),
      (${roleId}, ${f.company}, ${f.company}, 'read:branches:branch', '{"max_amount":1000.0000000000000001}'::jsonb),
      (${roleId}, ${f.company}, ${f.company}, 'read:businesses:company', '{"max_pct":100.00000000000000001}'::jsonb)`;
  const inspected = await createAccessReader(f.db).accessAt(
    f.company,
    isolatedUser,
    { kind: 'branch', branchId: f.branch },
    { allows: () => true },
  );
  expect(inspected).not.toBeNull();
  if (inspected === null) return;
  expect(
    mergeGrantConstraints(
      inspected.access.grants,
      'approve:discounts:branch',
      inspected.targets.target,
    ),
  ).toEqual({ max_amount: 1000n, backdate_days: 3, max_pct: 100 });
  for (const perm of ['read:branches:branch', 'read:businesses:company']) {
    const grant = inspected.access.grants.find((g) => g.permission === perm);
    expect(grant?.constraints).toEqual({ invalid: true });
    expect(
      mergeGrantConstraints(inspected.access.grants, perm, inspected.targets.target),
    ).toBeNull();
  }
});
