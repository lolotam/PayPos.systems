import { afterAll, beforeAll, expect, it } from 'vitest';
import { readOwnRatingsAccess } from '../persistence/own-ratings-access.ts';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from './permissions-screen.fixture.ts';

let f: PermissionFixture;
const context = (subjectUserId = f.managerId) => ({
  companyId: f.company,
  businessId: f.business,
  userId: f.managerId,
  subjectUserId,
  branchIds: [f.branch, f.siblingBranch],
});
const read = (subjectUserId?: string) =>
  f.db.withTenant(f.company, (tx) => readOwnRatingsAccess(tx, context(subjectUserId), new Date()));

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('RS-12 returns the branches a membership covers when the own grant and the feature allow it', async () => {
  await seedOverride(f, f.managerMember, { permission_code: 'read:ratings:own' });
  try {
    expect(await read()).toEqual([f.branch, f.siblingBranch]);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember} AND permission_code='read:ratings:own'`;
  }
});

const deleteOwnGrant = () =>
  f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember} AND permission_code='read:ratings:own'`;

it('RS-12 refuses the own code for another subject', async () => {
  await seedOverride(f, f.managerMember, { permission_code: 'read:ratings:own' });
  try {
    expect(await read()).toEqual([f.branch, f.siblingBranch]);
    expect(await read(f.userId)).toEqual([]);
  } finally {
    await deleteOwnGrant();
  }
});

it('RS-12 refuses an ended membership while its own grant is still in place', async () => {
  // المنحة تفضل مزروعة طول الاختبار: الرفض لازم يجي من انتهاء العضوية وحده، مش من غياب المنحة.
  await seedOverride(f, f.managerMember, { permission_code: 'read:ratings:own' });
  const now = new Date();
  try {
    expect(await read()).toEqual([f.branch, f.siblingBranch]);
    await f.h
      .owner`UPDATE memberships SET starts_at=${new Date(now.getTime() - 3_600_000).toISOString()},ends_at=${new Date(now.getTime() - 60_000).toISOString()} WHERE company_id=${f.company} AND id=${f.managerMember}`;
    expect(await read()).toEqual([]);
  } finally {
    await f.h
      .owner`UPDATE memberships SET starts_at=${new Date(now.getTime() - 60_000).toISOString()},ends_at=NULL WHERE company_id=${f.company} AND id=${f.managerMember}`;
    await deleteOwnGrant();
  }
});

it('RS-12 answers no branches while the customers feature is off', async () => {
  await seedOverride(f, f.managerMember, { permission_code: 'read:ratings:own' });
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'customers',false,'Synthetic feature refusal',${f.userId})`;
  try {
    expect(await read()).toEqual([]);
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='customers'`;
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.managerMember} AND permission_code='read:ratings:own'`;
  }
});
