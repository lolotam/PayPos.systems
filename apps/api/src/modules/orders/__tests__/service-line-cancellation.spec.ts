import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceLineCancellation } from '@pospay/contracts';
import { ordersLineCancellation } from '../orders.module.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let sessionId = '';
const saved: { id: string; price: string; discount: string; net: string; revision: number }[] = [];
type Snap = {
  nameAr?: string | null;
  nameEn?: string | null;
  role?: string | null;
  roleNameEn?: string | null;
  reason: string;
};

beforeAll(async () => {
  f = await sessionFixture();
  const created = await f.create.execute({
    ...f.context(),
    input: f.body([f.line(), f.line(), f.line(), f.line(), f.line(), f.line()]),
  });
  sessionId = created.session.id;
  for (const line of created.session.lines)
    saved.push({
      id: line.id,
      price: line.price,
      discount: line.discount,
      net: line.net,
      revision: line.revision,
    });
  const snaps: Snap[] = [
    { nameAr: 'ليلى', nameEn: 'Layla Canceller', reason: 'Corrected the visit' },
    { role: 'owner', roleNameEn: 'Owner', reason: 'Owner cancellation' },
    { role: 'general_manager', roleNameEn: 'Manager', reason: 'General cancellation' },
    { role: 'business_manager', roleNameEn: 'Manager', reason: 'Business cancellation' },
    { role: 'branch_manager', roleNameEn: 'Manager', reason: 'Branch cancellation' },
  ];
  for (const [index, snap] of snaps.entries()) await seedCancel(must(saved[index]).id, snap);
});
afterAll(async () => {
  await f?.close();
});

async function seedCancel(lineId: string, snap: Snap) {
  const role = snap.role ?? null;
  await f.h.owner.begin(async (tx) => {
    const updated = await tx`UPDATE service_lines SET status='CANCELLED', revision=revision+1
      WHERE company_id=${f.company} AND id=${lineId} AND status='ACTIVE' RETURNING id`;
    if (updated.length !== 1) throw new Error('cancel seed missed the line');
    await tx`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
      previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
      canceller_name_ar,canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en)
      SELECT company_id,${ids.newId()},business_id,id,revision,revision-1,price,discount,net,
        ${f.userId},${f.membership},'2026-10-14T08:00:06.000000Z'::timestamptz,${snap.reason},
        ${snap.nameAr ?? null},${snap.nameEn ?? null},${role},${role === null ? null : true},${null},
        ${role === null ? null : (snap.roleNameEn ?? 'Owner')}
      FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  });
}

const read = (
  lineId: string,
  extra: {
    userId?: string;
    sessionId?: string;
    branchId?: string;
    companyId?: string;
    businessId?: string;
  } = {},
) =>
  ordersLineCancellation(f.db).execute({
    ...f.context(),
    userId: extra.userId ?? f.ownerId,
    businessId: extra.businessId ?? f.business,
    branchId: extra.branchId ?? f.branch,
    companyId: extra.companyId ?? f.company,
    sessionId: extra.sessionId ?? sessionId,
    lineId,
  });

it('returns the one cancellation with money, the name, then the role, and hides raw identity', async () => {
  const named = must(saved[0]);
  const row = serviceLineCancellation.parse(await read(named.id));
  expect(row).toMatchObject({
    cancelled_at: '2026-10-14T08:00:06.000000Z',
    reason: 'Corrected the visit',
    canceller_label_ar: 'ليلى',
    canceller_label_en: 'Layla Canceller',
    previous: {
      revision: named.revision,
      price: named.price,
      discount: named.discount,
      net: named.net,
    },
  });
  expect(await read(must(saved[1]).id)).toMatchObject({
    canceller_label_ar: 'المالك',
    canceller_label_en: 'Owner',
    reason: 'Owner cancellation',
  });
  for (const line of saved.slice(2, 5)) {
    const manager = await read(line.id);
    expect(manager.canceller_label_ar).toBe('المدير');
    expect(manager.canceller_label_en).toBe('Manager');
    expect(manager.previous).toEqual({
      revision: line.revision,
      price: line.price,
      discount: line.discount,
      net: line.net,
    });
  }
  const payload = JSON.stringify([row, await read(must(saved[1]).id)]);
  for (const hidden of [
    f.userId,
    f.membership,
    'recorded_by',
    'recorded_by_membership_id',
    'canceller_name',
    'canceller_role',
    'cancelled_by',
    'previous_revision',
  ]) {
    expect(payload).not.toContain(hidden);
  }
});

it('refuses an in-scope line that has not been cancelled', async () => {
  await expect(read(must(saved[5]).id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('refuses a mismatched line, session, branch or tenant without saying which is missing', async () => {
  const lineId = must(saved[0]).id;
  await expect(read(ids.newId())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(read(lineId, { sessionId: ids.newId() })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const branchId = ids.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branchId},${f.business},'Synthetic cancellation branch')`;
  await expect(read(lineId, { branchId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    read(lineId, {
      companyId: f.otherCompany,
      businessId: f.foreignBusiness,
      branchId: f.foreignBranch,
      userId: f.ownerId,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('refuses cancel permission when the caller cannot read service sessions', async () => {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'cancel:service-lines:branch','ALLOW','BRANCH',${f.branch},NULL,'Synthetic cancel without read',${f.ownerId})`;
  try {
    await expect(read(must(saved[0]).id, { userId: f.userId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  }
});

it('refuses the cancellation read when the orders feature is disabled', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic cancellation feature test',${f.ownerId})`;
  try {
    await expect(read(must(saved[0]).id)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});
