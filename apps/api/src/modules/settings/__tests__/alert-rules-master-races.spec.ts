import { businessSettings } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';
import { createAlertRulesTransactions } from '../persistence/alert-rules-store.ts';
import { SetAlertsMaster } from '../use-cases/set-alerts-master/set-alerts-master.ts';

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

// نشاط جديد لكل حالة (#480): صف إعداداته لسه مش موجود، فحالة اللي قبلها ماتأثرش عليها.
const freshBusiness = async () => {
  const id = f.ids.newId();
  await f.h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${f.company}, ${id}, 'Synthetic master business', 'salon')`;
  return id;
};
const setMaster = (business: string, alerts_enabled: boolean) =>
  f.h.send('PUT', `/v1/businesses/${business}/alert-rules/master`, {
    cookie: f.cookie,
    company: f.company,
    body: { alerts_enabled },
  });
const readSettings = (business: string) =>
  f.h.send('GET', `/v1/businesses/${business}/settings`, { cookie: f.cookie, company: f.company });
const settingsRow = (business: string) =>
  f.h.owner`SELECT updated_at FROM business_settings
    WHERE company_id=${f.company} AND business_id=${business}`;
const masterAudits = (business: string) =>
  f.h.owner`SELECT action FROM audit_log
    WHERE company_id=${f.company} AND entity='alert_rules_master' AND entity_id=${business} ORDER BY id`;

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

it('issue #480: a master switch that changes nothing writes no settings row and no audit', async () => {
  const business = await freshBusiness();
  const before = await readSettings(business);
  expect(before.status).toBe(200);
  expect(businessSettings.parse(before.body).updated_at).toBeNull();

  const switched = await setMaster(business, true);
  expect(switched.status).toBe(200);

  // الطلب اللي ما غيّرش حاجة مايعملش صف إعدادات ومايكتبش تدقيق.
  expect(await settingsRow(business)).toEqual([]);
  expect(await masterAudits(business)).toEqual([]);
  const after = await readSettings(business);
  expect(after.status).toBe(200);
  expect(businessSettings.parse(after.body).updated_at).toBeNull();
});

it('issue #480: switching the master off creates the row once, invalidates the cached read and leaves it alone afterwards', async () => {
  const business = await freshBusiness();
  const cached = await readSettings(business);
  expect(cached.status).toBe(200);
  expect(businessSettings.parse(cached.body).updated_at).toBeNull();

  const switched = await setMaster(business, false);
  expect(switched.status).toBe(200);

  // القراءة المخزنة لازم تشوف الصف الجديد: الإبطال بيحصل بعد الـ commit.
  const fresh = await readSettings(business);
  expect(fresh.status).toBe(200);
  expect(businessSettings.parse(fresh.body).updated_at).not.toBeNull();
  const [created] = await settingsRow(business);
  const stamped = created?.['updated_at'];
  expect(stamped).not.toBeNull();

  // نفس القيمة تاني: مافيش كتابة، فالـ updated_at زي ما هو ومافيش سطر تدقيق زيادة.
  const again = await setMaster(business, false);
  expect(again.status).toBe(200);
  const [same] = await settingsRow(business);
  expect(same?.['updated_at']).toEqual(stamped);
  expect(await masterAudits(business)).toHaveLength(1);
});

it('issue #480: invalidates the settings cache again on a same-value retry when the first cache write throws', async () => {
  const business = await freshBusiness();
  let calls = 0;
  const useCase = new SetAlertsMaster(createAlertRulesTransactions(f.db, f.ids), {
    invalidate: async () => {
      calls += 1;
      if (calls === 1) throw new Error('redis down');
    },
  });
  const actor = { companyId: f.company, userId: f.userId };
  await expect(useCase.execute(actor, business, false)).rejects.toThrow('redis down');
  const [created] = await settingsRow(business);
  expect(created?.['updated_at']).not.toBeNull();
  expect(await masterAudits(business)).toHaveLength(1);

  await useCase.execute(actor, business, false);
  expect(calls).toBe(2);
  const [same] = await settingsRow(business);
  expect(same?.['updated_at']).toEqual(created?.['updated_at']);
  expect(await masterAudits(business)).toHaveLength(1);
});
