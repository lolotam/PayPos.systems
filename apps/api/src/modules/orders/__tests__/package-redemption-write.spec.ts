import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

it('RD-01 redeems the lowest free slot, writes one redemption and puts the package on the event line', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const result = await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  expect(result.session.lines).toHaveLength(1);
  expect(result.session.lines[0]).toMatchObject({ list_price: '1.000', price: '1.000', discount: '0.000', net: '1.000' });
  const slots = await f.h.owner`SELECT ordinal,state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement} ORDER BY ordinal`;
  expect(slots).toHaveLength(2);
  expect(slots[0]).toMatchObject({ ordinal: 1, state: 'USED' });
  expect(slots[1]).toMatchObject({ ordinal: 2, state: 'FREE' });
  const redemptions = await f.h.owner`SELECT id,line_id,component_id FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`;
  expect(redemptions).toHaveLength(1);
  expect(redemptions[0]).toMatchObject({ component_id: seeded.component });
  const lines = await f.h.owner`SELECT id,redemption_id,list_price,price,discount,net,effective_discount_bps FROM service_lines WHERE session_id=${result.session.id}`;
  expect(lines[0]).toMatchObject({ redemption_id: redemptions[0]?.['id'], list_price: '1.000', price: '1.000', discount: '0.000', net: '1.000', effective_discount_bps: 0 });
  expect(redemptions[0]?.['line_id']).toBe(lines[0]?.['id']);
  const events = await f.h.owner`SELECT payload FROM outbox WHERE aggregate_id=${result.session.id}`;
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events[0]?.['payload'])).toContain(seeded.entitlement);
});

it('RD-02 saves a paid line and a package line in one request and keeps the request order', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const result = await f.create.execute({ ...f.context(ids.newId()),
    input: f.body([f.line(f.services[1], '7.125'), packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  expect(result.session.lines.map((line) => line.list_price)).toEqual(['7.125', '1.000']);
  expect(result.session.lines.map((line) => line.input_index)).toEqual([0, 1]);
});

it('RD-02 gives two drafts of one component the ordinals k and k+1', async () => {
  const seeded = await seedPackage(f, { sessions: 3, expiresOn: '2026-12-30' });
  const result = await f.create.execute({ ...f.context(ids.newId()),
    input: f.body([packageLine(f, seeded.entitlement), packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  const slots = await f.h.owner`SELECT ordinal,state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement} ORDER BY ordinal`;
  expect(slots.map((slot) => slot['state'])).toEqual(['USED', 'USED', 'FREE']);
  const redemptions = await f.h.owner`SELECT id FROM package_redemptions WHERE entitlement_id=${seeded.entitlement} ORDER BY id`;
  expect(redemptions).toHaveLength(2);
});

it('RD-02 appends a package line to an existing visit', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const first = await f.create.execute({ ...f.context(ids.newId()), input: f.body([f.line()]) });
  const appended = await f.append.execute({ ...f.context(ids.newId()), sessionId: first.session.id, input: { lines: [packageLine(f, seeded.entitlement)] } });
  expect(appended.outcome).toBe('COMPLETE');
  expect(appended.session.lines.map((line) => line.list_price)).toEqual(['25.000', '1.000']);
  const slots = await f.h.owner`SELECT ordinal,state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement} ORDER BY ordinal`;
  expect(slots).toHaveLength(2);
  expect(slots[0]).toMatchObject({ state: 'USED' });
});

it('RD-04 refuses a visit after the package expiry and a visit before the sale', async () => {
  const expired = await seedPackage(f, { sessions: 2, expiresOn: '2026-10-13' });
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, expired.entitlement)]) }))
    .rejects.toMatchObject({ code: 'PACKAGE_EXPIRED' });
  const future = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30', soldAt: new Date('2026-10-20T08:00:00.000Z') });
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, future.entitlement)]) }))
    .rejects.toMatchObject({ code: 'PACKAGE_NOT_YET_VALID' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id IN (${expired.entitlement},${future.entitlement})`).toHaveLength(0);
});

it('RD-05 answers every foreign entitlement with one code and no redemption', async () => {
  const other = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.company},${other},'Synthetic other customer','+999999997321','en',now(),now())`;
  const otherService = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${otherService},${f.secondBusiness},'Synthetic second business service',25.000,'FOLLOW_PLAN')`;
  const foreignCustomer = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30', customerId: other });
  const foreignBusiness = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30', businessId: f.secondBusiness, serviceId: otherService });
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, foreignCustomer.entitlement)]) }))
    .rejects.toMatchObject({ code: 'PACKAGE_NOT_USABLE_HERE' });
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, foreignBusiness.entitlement, otherService)]) }))
    .rejects.toMatchObject({ code: 'PACKAGE_NOT_USABLE_HERE' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id IN (${foreignCustomer.entitlement},${foreignBusiness.entitlement})`).toHaveLength(0);
});

it('RD-07 keeps the recording rules on a package line', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  await expect(f.create.execute({ ...f.context(ids.newId()), input: f.body([
    { ...packageLine(f, seeded.entitlement), performers: [
      { employee_id: must(f.employees[0]), share_bps: 2000 }, { employee_id: must(f.employees[1]), share_bps: 2000 },
      { employee_id: must(f.employees[2]), share_bps: 2000 }, { employee_id: must(f.employees[3]), share_bps: 2000 },
      { employee_id: must(f.employees[0]), share_bps: 2000 }] },
  ]) })).rejects.toMatchObject({ code: 'SESSION_PERFORMER_SHARES_INVALID' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
});

it('RD-08 replays the same key with the original answer and takes no second slot', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const key = ids.newId();
  const input = f.body([packageLine(f, seeded.entitlement)]);
  const first = await f.create.execute({ ...f.context(key), input });
  expect(await f.create.execute({ ...f.context(key), input })).toEqual(first);
  const slots = await f.h.owner`SELECT ordinal,state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement} ORDER BY ordinal`;
  expect(slots.map((slot) => slot['state'])).toEqual(['USED', 'FREE']);
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(1);
});

it('RD-09 never takes an imported used slot', async () => {
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-12-30', used: 1 });
  const result = await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  const slots = await f.h.owner`SELECT ordinal,state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement} ORDER BY ordinal`;
  expect(slots.map((slot) => slot['state'])).toEqual(['IMPORTED_USED', 'USED']);
});

it('RD-03 lets one of two concurrent visits take the last free slot and refuses the other', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const results = await Promise.allSettled([
    f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) }),
    f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const refused = results.filter((result) => result.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'PACKAGE_NO_FREE_SESSION' });
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(1);
  const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots.map((slot) => slot['state'])).toEqual(['USED']);
});
