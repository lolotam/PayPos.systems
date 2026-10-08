import { afterAll, beforeAll, expect, it } from 'vitest';
import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import {
  ALERT_AT,
  notClockedInFixture,
  ROLE,
  type NotClockedInFixture,
} from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
beforeAll(async () => {
  f = await notClockedInFixture();
});
afterAll(async () => {
  await f?.close();
});

it.each([null, 'Asia/Dubai'])(
  'keeps both names and the saved schedule timezone after the branch changes to %s',
  async (branchZone) => {
    const tenant = await f.tenant();
    await f.owner`UPDATE businesses SET timezone='Asia/Riyadh' WHERE company_id=${tenant.company} AND id=${tenant.business}`;
    const userId = await f.user('manager');
    await f.member({
      tenant,
      userId,
      roleId: ROLE.owner,
      scopeType: 'COMPANY',
      scopeId: tenant.company,
    });
    const employee = await f.employee(tenant, { nameAr: 'ليلى', nameEn: 'Laila' });
    await f.shift(tenant, employee);
    await f.owner`UPDATE branches SET name_ar='استوديو', name_en='Studio 2026', timezone=${branchZone}
    WHERE company_id=${tenant.company} AND id=${tenant.branch}`;
    f.setNow(ALERT_AT);
    expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
    await notClockedInInbox(f.ids, f.db).deliver(f.owner, tenant.company);
    const rows =
      await f.owner`SELECT safe_parameters FROM in_app_notifications WHERE company_id=${tenant.company}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['safe_parameters']).toEqual([
      { name: 'employee_name_ar', type: 'text', value: 'ليلى' },
      { name: 'employee_name_en', type: 'text', value: 'Laila' },
      { name: 'branch_name_ar', type: 'text', value: 'استوديو' },
      { name: 'branch_name_en', type: 'text', value: 'Studio 2026' },
      { name: 'shift_start', type: 'text', value: '10:00' },
    ]);
  },
);

it('the tenancy reader rejects a foreign branch and a branch in another business', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const business = await f.business(a.company);
  const read = (company: string, businessId: string, branch: string) =>
    f.db.withTenant(a.company, (tx) =>
      branchPlaceAdapter.forBranch(tx, company, businessId, branch),
    );
  expect(await read(a.company, business, a.branch)).toBeNull();
  expect(await read(a.company, b.business, b.branch)).toBeNull();
  expect(await read(b.company, b.business, b.branch)).toBeNull();
  expect(await read(a.company, a.business, f.ids.newId())).toBeNull();
});
