import { afterAll, beforeAll, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

// ترتيب الأقفال اللي الاختبار بيحميه: companies → memberships → businesses → business_settings، في المسارين.
const master = (alerts_enabled: boolean) =>
  f.h.send('PUT', `/v1/businesses/${f.business}/alert-rules/master`, {
    cookie: f.cookie,
    company: f.company,
    body: { alerts_enabled },
  });
const names = (label: string) =>
  f.h.send('PATCH', `/v1/businesses/${f.business}/settings/identity`, {
    cookie: f.cookie,
    company: f.company,
    body: { official_name_ar: `صالون ${label}`, official_name_en: `Salon ${label}` },
  });

it('the master switch and the identity names write the same row without locking each other out', async () => {
  let enabled = true;
  let label = 'Race 0';
  for (let round = 0; round < 5; round++) {
    enabled = round % 2 === 0;
    label = `Race ${round}`;
    const [switched, renamed] = await Promise.all([master(enabled), names(label)]);
    expect(switched.status).toBe(200);
    expect(renamed.status).toBe(200);
    for (const response of [switched, renamed]) {
      expect(response.body['code']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(
        /40P01|deadlock|TRANSACTION_RETRY_REQUIRED/,
      );
    }
  }
  const [row] = await f.h.owner`SELECT alerts_enabled, official_name_ar, official_name_en
    FROM business_settings WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['alerts_enabled']).toBe(enabled);
  expect(row?.['official_name_ar']).toBe(`صالون ${label}`);
  expect(row?.['official_name_en']).toBe(`Salon ${label}`);
});
