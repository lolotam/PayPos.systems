import { errorEnvelope } from '@pospay/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const url = (business = f.business) => `/v1/businesses/${business}/settings/imported-refunds`;
const put = (body: object, cookie = f.cookie, company = f.company, business = f.business) =>
  f.h.app.inject({
    method: 'PUT',
    url: url(business),
    headers: { cookie, 'x-company-id': company },
    payload: body,
  });
const audits = (business = f.business) =>
  f.h.owner`SELECT actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company} AND entity = 'business_settings'
      AND entity_id = ${business} AND action = 'settings.imported_refunds_switched'
    ORDER BY id`;

it('IRS-06: two first writes serialize and each audit entry carries the true previous value', async () => {
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:imported-refunds:business',
    scope_type: 'BUSINESS',
    scope_id: f.otherBusiness,
  });
  await f.h.owner`DELETE FROM business_settings WHERE company_id = ${f.company}
    AND business_id = ${f.otherBusiness}`;
  // القيمتان مختلفتان عشان الكاتب التاني يكتب تغييراً فعلياً بعد انتظاره.
  const [first, second] = await Promise.all([
    put({ imported_refunds_enabled: true }, f.cookie, f.company, f.otherBusiness),
    put({ imported_refunds_enabled: false }, f.managerCookie, f.company, f.otherBusiness),
  ]);
  // الكاتب التاني بيستنى على قفل الشركة أو قفل الصف، فالقرار بيتاخد بالترتيب اللي اتكتب بيه فعلاً.
  expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
  const rows = await audits(f.otherBusiness);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ before: { imported_refunds_enabled: null } });
  expect(rows[1]).toMatchObject({
    before: {
      imported_refunds_enabled: (rows[0] as { after: { imported_refunds_enabled: boolean } }).after
        .imported_refunds_enabled,
    },
  });
  const finalValue = (rows[1] as { after: { imported_refunds_enabled: boolean } }).after
    .imported_refunds_enabled;
  expect(
    await f.h.owner`SELECT imported_refunds_enabled FROM business_settings
      WHERE company_id = ${f.company} AND business_id = ${f.otherBusiness}`,
  ).toEqual([{ imported_refunds_enabled: finalValue }]);
  const actors = new Set(rows.map((row) => row['actor_user_id']));
  expect(actors).toEqual(new Set([f.userId, f.managerId]));
});

it('IRS-06: a revocation that commits while the write waits refuses it with no change and no audit', async () => {
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:imported-refunds:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, imported_refunds_enabled)
    VALUES (${f.company}, ${f.business}, true)
    ON CONFLICT (company_id, business_id) DO UPDATE SET imported_refunds_enabled = true`;
  const before = await audits();
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  await blocker`BEGIN`;
  await blocker`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business} FOR UPDATE`;
  const request = put({ imported_refunds_enabled: false }, f.managerCookie);
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waiting = await observer`SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%business_settings%'`;
        expect(waiting.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
    await observer`UPDATE permission_overrides SET expires_at = clock_timestamp()
      WHERE company_id = ${f.company} AND membership_id = ${f.managerMember}
        AND permission_code = 'manage:imported-refunds:business'`;
  } finally {
    await blocker`ROLLBACK`;
    await blocker.end();
    await observer.end();
  }
  const res = await request;
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
  expect(await audits()).toEqual(before);
  expect(
    await f.h.owner`SELECT imported_refunds_enabled FROM business_settings
      WHERE company_id = ${f.company} AND business_id = ${f.business}`,
  ).toEqual([{ imported_refunds_enabled: true }]);
});
