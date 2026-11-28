import { afterAll, beforeAll, expect, it } from 'vitest';

import { mergeGrantConstraints } from '../domain/access.ts';
import { createAccessReader } from '../persistence/access-reader.ts';
import { permissionFixture, type PermissionFixture } from './permissions-screen.fixture.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
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
  await seedConstrainedRoles(f);
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

it('rejects fractional monetary constraints before JS JSON number rounding (#10)', async () => {
  await f.h.owner`
    UPDATE role_permissions SET constraints = '{"max_amount":1000.0000000000000001}'::jsonb
    WHERE company_id = ${f.company} AND permission_code = 'approve:discounts:branch'`;
  const inspected = await createAccessReader(f.db).accessAt(
    f.company,
    f.managerId,
    { kind: 'branch', branchId: f.branch },
    { allows: () => true },
  );
  expect(inspected).not.toBeNull();
  if (inspected === null) return;
  const corrupted = inspected.access.grants.find(
    (g) => g.permission === 'approve:discounts:branch',
  );
  expect(corrupted?.constraints).toEqual({ invalid: true });
  expect(
    mergeGrantConstraints(
      inspected.access.grants,
      'approve:discounts:branch',
      inspected.targets.target,
    ),
  ).toBeNull();
});
