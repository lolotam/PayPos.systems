import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { customerPackageDetail } from '@pospay/contracts';
import { ids, type SessionFixture } from './session.fixture.ts';
import {
  CURRENT_EXPIRY,
  extensionBody,
  packageExtensionFixture,
  postExtension,
  seedSoldPackage,
  type PackageExtensionFixture,
} from './package-extension.fixture.ts';

let fixture: PackageExtensionFixture;
let f: SessionFixture;

beforeAll(async () => {
  fixture = await packageExtensionFixture();
  f = fixture.f;
});

beforeEach(() => {
  fixture.setAt(new Date('2026-10-15T08:00:00.000Z'));
});

afterAll(async () => {
  await f?.close();
});

const detailPath = (entitlementId: string, branchId = f.branch, customerId = f.customer) =>
  `/v1/businesses/${f.business}/branches/${branchId}/customers/${customerId}/packages/${entitlementId}`;

it('returns can_extend: true for a cashier with an extend grant who records but cannot read sessions', async () => {
  const res = await f.h.send('GET', detailPath(fixture.sold.entitlement), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(res.status).toBe(200);
  const detail = customerPackageDetail.parse(res.body);
  expect(detail.can_extend).toBe(true);
});

it('returns can_extend: false for a cashier without the extend grant', async () => {
  const [removed] = await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id=${f.membership}
      AND permission_code='extend:packages:branch' AND effect='ALLOW'
    RETURNING id, scope_id, reason, granted_by`;
  expect(removed).toBeDefined();
  try {
    const res = await f.h.send('GET', detailPath(fixture.sold.entitlement), {
      cookie: f.cookie,
      company: f.company,
    });
    expect(res.status).toBe(200);
    const detail = customerPackageDetail.parse(res.body);
    expect(detail.can_extend).toBe(false);
  } finally {
    if (removed) {
      await f.h.owner`INSERT INTO permission_overrides
        (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
        VALUES(${f.company},${removed['id']},${f.membership},'extend:packages:branch','ALLOW','BRANCH',${removed['scope_id']},
          NULL,${removed['reason']},${removed['granted_by']})`;
    }
  }
});

it('returns can_extend: false when the operator has an extend:packages:branch DENY override', async () => {
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'extend:packages:branch','DENY','BRANCH',${f.branch},
      'Synthetic extension deny',${f.ownerId})`;
  try {
    const res = await f.h.send('GET', detailPath(fixture.sold.entitlement), {
      cookie: f.cookie,
      company: f.company,
    });
    expect(res.status).toBe(200);
    const detail = customerPackageDetail.parse(res.body);
    expect(detail.can_extend).toBe(false);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
});

it('surfaces the posted extension reason in extension history over HTTP', async () => {
  const seeded = await seedSoldPackage(f, { sessions: 2, expiresOn: CURRENT_EXPIRY });
  const reason = 'Synthetic extension reason';
  const postRes = await postExtension(f, seeded.entitlement, {
    body: extensionBody({ reason }),
  });
  expect(postRes.status).toBe(201);

  const res = await f.h.send('GET', detailPath(seeded.entitlement), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(res.status).toBe(200);
  const detail = customerPackageDetail.parse(res.body);
  expect(detail.extensions).toHaveLength(1);
  expect(detail.extensions[0]?.reason).toBe(reason);
});
