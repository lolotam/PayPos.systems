import { afterAll, beforeAll, expect, it } from 'vitest';
import { runTips, tip, tipInput } from '../../../../test/session-tips.fixture.ts';
import { ids, must } from './session.fixture.ts';
import { cancelInput, cancelQuiet, runCancel } from './line-cancel.helpers.ts';
import { performersFixture, performersInput, runChange, type PerformersFixture } from './line-performers.helpers.ts';
import { packageLine } from './package-redemption.fixture.ts';
import { packageEvents, packageState, redeemedVisit } from './package-cancel.fixture.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('RC-04 the inherited tip guard refuses before any package reversal', async () => {
  const visit = await redeemedVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  const before = await packageState(f, visit);
  const key = ids.newId();
  await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key }))
    .rejects.toMatchObject({ code: 'SESSION_CANCEL_BLOCKED_BY_TIP' });
  expect(await packageState(f, visit)).toEqual(before);
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});

it('RC-01 the existing HTTP cancellation route accepts a redeemed line', async () => {
  const visit = await redeemedVisit(f);
  const reply = await f.h.send('POST', `${f.base}/${visit.sessionId}/lines/${visit.lineId}/cancellation`, {
    cookie: f.editorCookie, company: f.company, key: ids.newId(), body: cancelInput(),
  });
  expect(reply.status).toBe(200);
  expect(reply.body).toMatchObject({ line: { status: 'CANCELLED', net: '1.000' } });
  expect((await packageState(f, visit))['redemption']).toMatchObject({ reversed_at: expect.any(String) });
});

it('RC-01 cancels after expiry, shares the history ID and preserves the package event and money', async () => {
  const visit = await redeemedVisit(f);
  const response = await runCancel(f, visit.sessionId, visit.lineId);
  expect(response).toMatchObject({ line: { status: 'CANCELLED', revision: 2, net: '1.000' } });
  const saved = await packageState(f, visit);
  expect(saved).toMatchObject({
    line: { status: 'CANCELLED', revision: 2, redemption_id: visit.redemptionId, net: '1.000' },
    redemption: { id: visit.redemptionId, reversed_at: expect.any(String) },
    slots: [{ ordinal: 1, state: 'FREE', current_redemption_id: null },
      { ordinal: 2, state: 'FREE', current_redemption_id: null }],
    cancellations: [{ id: expect.any(String), previous_revision: 1, revision: 2 }],
  });
  const [history] = await f.h.owner`SELECT c.id,r.reversal_cancellation_id,r.reversed_at,c.cancelled_at
    FROM service_line_cancellations c JOIN package_redemptions r ON r.company_id=c.company_id
      AND r.line_id=c.line_id WHERE c.company_id=${f.company} AND c.line_id=${visit.lineId}`;
  expect(history?.['id']).toBe(history?.['reversal_cancellation_id']);
  expect(history?.['reversed_at']).toEqual(history?.['cancelled_at']);
  const events = await packageEvents(f, visit);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ status: 'CANCELLED', revision: 2,
    list_price: '1.000', price: '1.000', discount: '0.000', net: '1.000',
    package: { entitlement_id: visit.entitlement, component_id: visit.component, ordinal: 1 },
    change: { kind: 'LINE_CANCELLED' } });
});

it('RC-02 reuses the lowest freed ordinal for another visit on a valid date', async () => {
  const visit = await redeemedVisit(f, 3);
  await runCancel(f, visit.sessionId, visit.lineId);
  const next = await f.create.execute({ ...f.context(ids.newId()),
    input: f.body([packageLine(f, visit.entitlement)]) });
  const rows = await f.h.owner`SELECT r.id,s.ordinal FROM package_redemptions r
    JOIN package_session_slots s ON s.company_id=r.company_id AND s.id=r.slot_id
    WHERE r.company_id=${f.company} AND r.line_id=${must(next.session.lines[0]).id}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['ordinal']).toBe(1);
  expect(rows[0]?.['id']).not.toBe(visit.redemptionId);
});

it('RC-03 replay returns the stored response after the freed slot has been reused', async () => {
  const visit = await redeemedVisit(f);
  const key = ids.newId();
  const first = await runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key });
  await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, visit.entitlement)]) });
  const before = await packageState(f, visit);
  expect(await runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key })).toEqual(first);
  expect(await packageState(f, visit)).toEqual(before);
  expect(await packageEvents(f, visit)).toHaveLength(1);
  await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput({ expected_revision: 2 })))
    .rejects.toMatchObject({ code: 'SESSION_LINE_ALREADY_CANCELLED' });
  expect(await packageState(f, visit)).toEqual(before);
});

it('RC-05 freeing an expired package never makes a later visit redeemable', async () => {
  const visit = await redeemedVisit(f);
  await runCancel(f, visit.sessionId, visit.lineId);
  const before = await packageState(f, visit);
  await expect(f.create.execute({ ...f.context(ids.newId()), input: {
    ...f.body([packageLine(f, visit.entitlement)]), occurred_at: '2026-10-15T07:00:00Z',
  } })).rejects.toMatchObject({ code: 'PACKAGE_EXPIRED' });
  expect(await packageState(f, visit)).toEqual(before);
});

it('RC-07 performer replacement preserves the redemption, slot and the package block', async () => {
  const visit = await redeemedVisit(f);
  const before = await packageState(f, visit);
  const result = await runChange(f, visit.sessionId, visit.lineId, performersInput({
    performers: [{ employee_id: must(f.employees[1]), share_bps: 10000 }],
  }));
  expect(result).toMatchObject({ line: { revision: 2, net: '1.000', performers: [
    { employee_id: must(f.employees[1]), share_bps: 10000 },
  ] } });
  const after = await packageState(f, visit);
  expect(after['redemption']).toEqual(before['redemption']);
  expect(after['slots']).toEqual(before['slots']);
  const events = await packageEvents(f, visit);
  expect(events[0]?.['payload']).toMatchObject({ status: 'ACTIVE', list_price: '1.000', net: '1.000',
    package: { entitlement_id: visit.entitlement, component_id: visit.component, ordinal: 1 } });
  await runCancel(f, visit.sessionId, visit.lineId, cancelInput({ expected_revision: 2 }));
  expect((await packageState(f, visit))['line']).toMatchObject({ status: 'CANCELLED', revision: 3 });
});

it.each(['tenant', 'business', 'branch'] as const)('RC-04 refuses cross-%s cancellation without effects', async (scope) => {
  const visit = await redeemedVisit(f);
  const before = await packageState(f, visit);
  const key = ids.newId();
  const options = scope === 'tenant' ? { companyId: f.otherCompany }
    : scope === 'business' ? { businessId: f.secondBusiness, branchId: f.secondBranch }
      : { branchId: f.secondBranch };
  await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { ...options, key }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await packageState(f, visit)).toEqual(before);
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});
