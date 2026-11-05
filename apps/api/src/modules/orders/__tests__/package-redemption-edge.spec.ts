import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

// زيارة قريبة من منتصف الليل: 21:30Z هي 00:30 في الكويت (15 أكتوبر) و22:30 في لندن (14 أكتوبر).
const MIDNIGHT = '2026-10-14T21:30:00.000Z';

it('RD-04b measures the expiry by the serving branch date, not the business date', async () => {
  await f.h.owner`UPDATE branches SET timezone='Europe/London' WHERE company_id=${f.company} AND id=${f.branch}`;
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-10-14' });
  const result = await f.create.execute({ ...f.context(ids.newId()),
    input: { ...f.body([packageLine(f, seeded.entitlement)]), occurred_at: MIDNIGHT } });
  expect(result.outcome).toBe('COMPLETE');
  // يوم المحاسبة يبقى يوم النشاط، وصلاحية الباقة يوم الفرع.
  expect(result.session.business_date).toBe('2026-10-15');
  expect(result.session.business_timezone).toBe('Asia/Kuwait');
  expect(result.session.lines[0]).toMatchObject({ list_price: '1.000', price: '1.000', discount: '0.000' });
});

it('RD-04b falls back to the business timezone when the branch has none', async () => {
  await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.branch}`;
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-10-14' });
  await expect(f.create.execute({ ...f.context(ids.newId()),
    input: { ...f.body([packageLine(f, seeded.entitlement)]), occurred_at: MIDNIGHT } }))
    .rejects.toMatchObject({ code: 'PACKAGE_EXPIRED' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
});

it('RD-04b keeps the original visit date on the append route', async () => {
  await f.h.owner`UPDATE branches SET timezone='Europe/London' WHERE company_id=${f.company} AND id=${f.branch}`;
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-10-14' });
  const first = await f.create.execute({ ...f.context(ids.newId()),
    input: { ...f.body([f.line()]), occurred_at: MIDNIGHT } });
  expect(first.session.business_date).toBe('2026-10-15');
  const appended = await f.append.execute({ ...f.context(ids.newId()), sessionId: first.session.id,
    input: { lines: [packageLine(f, seeded.entitlement)] } });
  expect(appended.outcome).toBe('COMPLETE');
  expect(appended.session.lines.map((line) => line.list_price)).toEqual(['25.000', '1.000']);
  expect(appended.session.business_date).toBe('2026-10-15');
});

it('RD-03 does not deadlock when two batches ask for the same components in reverse order', async () => {
  const first = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const second = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const results = await Promise.allSettled([
    f.create.execute({ ...f.context(ids.newId()), input: f.body([
      packageLine(f, first.entitlement, must(f.services[0]), must(f.employees[0])),
      packageLine(f, second.entitlement, must(f.services[0]), must(f.employees[1]))]) }),
    f.create.execute({ ...f.context(ids.newId()), input: f.body([
      packageLine(f, second.entitlement, must(f.services[0]), must(f.employees[2])),
      packageLine(f, first.entitlement, must(f.services[0]), must(f.employees[3]))]) }),
  ]);
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  for (const entitlement of [first.entitlement, second.entitlement]) {
    const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${entitlement} ORDER BY ordinal`;
    expect(slots.map((slot) => slot['state'])).toEqual(['USED', 'USED']);
    const redemptions = await f.h.owner`SELECT slot_id FROM package_redemptions WHERE entitlement_id=${entitlement}`;
    expect(redemptions).toHaveLength(2);
    expect(new Set(redemptions.map((row) => row['slot_id'])).size).toBe(2);
  }
});

it('RD-02 keeps the request order when a paid line between two package lines is rejected', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const result = await f.create.execute({ ...f.context(ids.newId()), input: f.body([
    packageLine(f, seeded.entitlement),
    f.line(f.services[1], '7.125', '5.000'),
    packageLine(f, seeded.entitlement),
    f.line(f.services[3], '15.000')]) });
  expect(result.outcome).toBe('PARTIAL');
  expect(result.rejected_lines).toHaveLength(1);
  expect(result.rejected_lines[0]).toMatchObject({ input_index: 1, code: 'SESSION_DISCOUNT_ABOVE_LIMIT' });
  expect(result.session.lines.map((line) => line.input_index)).toEqual([0, 2, 3]);
  expect(result.session.lines.map((line) => line.ordinal)).toEqual([1, 2, 3]);
  expect(result.session.lines.map((line) => line.list_price)).toEqual(['1.000', '1.000', '15.000']);
  const redemptions = await f.h.owner`SELECT line_id FROM package_redemptions WHERE entitlement_id=${seeded.entitlement} ORDER BY id`;
  expect(redemptions).toHaveLength(2);
});

it('RD-09 rolls the whole visit back when one package line has no free session left', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const before = await f.h.owner`SELECT id FROM service_lines WHERE company_id=${f.company}`;
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([
    f.line(f.services[1], '7.125'),
    packageLine(f, seeded.entitlement),
    packageLine(f, seeded.entitlement)]) }))
    .rejects.toMatchObject({ code: 'PACKAGE_NO_FREE_SESSION' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
  const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots.map((slot) => slot['state'])).toEqual(['FREE']);
  expect(await f.h.owner`SELECT id FROM service_lines WHERE company_id=${f.company}`).toHaveLength(before.length);
});

it('FR-025 keeps a zero-value package under a zero discount limit', async () => {
  await f.h.owner`UPDATE memberships SET limit_bps=0 WHERE company_id=${f.company} AND id=${f.membership}`;
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30', unit: '0.000' });
  const result = await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  expect(result.session.lines[0]).toMatchObject({ list_price: '0.000', price: '0.000', discount: '0.000', net: '0.000', effective_discount_bps: 0 });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(1);
  await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
});
