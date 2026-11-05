import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { createSessionRecovery } from '../persistence/session-recovery.adapter.ts';
import { ordersTransactions } from '../orders.module.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
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

it('RD-04b validates the expiry on the normalized visit instant, not the raw client clock', async () => {
  // ساعة السيرفر قبل منتصف ليل الكويت بنصف دقيقة، والعميل أرسل وقتاً بعده بدقيقة.
  f.setAt(new Date('2026-10-14T20:59:30.000Z'));
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-10-14' });
  const result = await f.create.execute({ ...f.context(ids.newId()),
    input: { ...f.body([packageLine(f, seeded.entitlement)]), occurred_at: '2026-10-14T21:00:30.000Z' } });
  expect(result.outcome).toBe('COMPLETE');
  expect(result.session.business_date).toBe('2026-10-14');
  expect(result.session.occurred_at).toBe('2026-10-14T20:59:30.000Z');
  f.setAt(new Date('2026-10-15T08:00:00.000Z'));
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

it('uses the final clock and performer instant after awaiting the slot lock when occurred_at is omitted', async () => {
  const before = new Date('2026-10-14T20:59:30.000Z');
  const after = new Date('2026-10-14T21:00:30.000Z');
  f.setAt(before);
  const seeded = await seedPackage(f, { sessions: 2, expiresOn: '2026-10-15' });
  let performerAt: Date | undefined;
  const transactions: typeof f.transactions = {
    run: (context, work) => f.transactions.run(context, (tx) => work({
      ...tx,
      packages: {
        ...tx.packages,
        lockSlots: async (ids) => {
          const slots = await tx.packages.lockSlots(ids);
          await Promise.resolve();
          f.setAt(after);
          return slots;
        },
      },
      performers: {
        ...tx.performers,
        read: (ids, at) => { performerAt = at; return tx.performers.read(ids, at); },
      },
    })),
  };
  const create = new RecordServiceSessionUseCase(transactions, createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  try {
    const result = await create.execute({ ...f.context(ids.newId()), input: {
      customer_id: f.customer, lines: [packageLine(f, seeded.entitlement)],
    } });
    expect(result.session.occurred_at).toBe(after.toISOString());
    expect(result.session.business_date).toBe('2026-10-15');
    expect(performerAt).toEqual(after);
    const rows = await f.h.owner`SELECT occurred_at FROM service_sessions WHERE id=${result.session.id}`;
    expect(new Date(rows[0]?.['occurred_at'] as string)).toEqual(after);
  } finally { f.setAt(AT); }
});

it('RD-08b rolls the visit, the slot, the event and the idempotency key back when the slot update fails', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const snapshot = () => f.h.owner`SELECT (SELECT count(*) FROM service_sessions) AS sessions,(SELECT count(*) FROM service_lines) AS lines,
    (SELECT count(*) FROM package_redemptions) AS redemptions,(SELECT count(*) FROM outbox) AS events,(SELECT count(*) FROM idempotency_keys) AS keys`;
  const before = await snapshot();
  // فشل متعمّد بعد كتابة صف الاسترداد وقبل نقل الجلسة: كل المعاملة تتراجع سوا.
  const failing = interceptDatabase(f.db, async (statement) => {
    if (statement.includes('UPDATE package_session_slots')) throw new Error('deliberate failure after the redemption write');
  });
  const failingCreate = new RecordServiceSessionUseCase(ordersTransactions(failing, ids, f.clock),
    createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  const key = ids.newId();
  await expect(failingCreate.execute({ ...f.context(key), input: f.body([packageLine(f, seeded.entitlement)]) }))
    .rejects.toThrow('SESSION_PERSISTENCE_FAILED');
  // لا سطر ولا زيارة ولا استرداد ولا حدث ولا claim تبقّى.
  expect(await snapshot()).toEqual(before);
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
  const slots = await f.h.owner`SELECT state FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots.map((slot) => slot['state'])).toEqual(['FREE']);
  // نفس المفتاح تاني يعدّي، لأن claim الـ idempotency اتراجع مع المعاملة زي كل الأثر.
  const result = await f.create.execute({ ...f.context(key), input: f.body([packageLine(f, seeded.entitlement)]) });
  expect(result.outcome).toBe('COMPLETE');
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(1);
});

it('RD-09 does not leak the package state to a recorder whose membership lapsed during the lock wait', async () => {
  // العضوية سارية قبل الانتظار، وتتنتهي أثناءه؛ والباقة بلا جلسة حرة، فالخطأ يخرج من باب الباقة.
  const before = new Date('2026-10-14T20:59:30.000Z');
  const after = new Date('2026-10-14T21:00:30.000Z');
  f.setAt(before);
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T21:00:00Z' WHERE company_id=${f.company} AND id=${f.membership}`;
  const seeded = await seedPackage(f, { sessions: 1, used: 1, expiresOn: '2026-12-30' });
  const transactions: typeof f.transactions = {
    run: (context, work) => f.transactions.run(context, (tx) => work({
      ...tx,
      packages: {
        ...tx.packages,
        lock: async (customerId, pairs) => {
          const snapshots = await tx.packages.lock(customerId, pairs);
          await Promise.resolve();
          f.setAt(after);
          return snapshots;
        },
      },
    })),
  };
  const create = new RecordServiceSessionUseCase(transactions, createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  try {
    // الصلاحية سقطت، فالخطأ FORBIDDEN؛ ولا تتسرّب حالة الباقة لصاحب صلاحية انتهت.
    await expect(create.execute({ ...f.context(ids.newId()), input: {
      customer_id: f.customer, lines: [packageLine(f, seeded.entitlement)],
    } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
  } finally {
    f.setAt(AT);
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});
