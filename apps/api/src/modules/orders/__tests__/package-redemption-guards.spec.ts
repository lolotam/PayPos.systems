import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must } from './session.fixture.ts';
import { editBody, recorded, runEdit } from './line-edit.helpers.ts';
import { cancelInput, runCancel } from './line-cancel.helpers.ts';
import {
  performersFixture,
  performersInput,
  runChange,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => {
  f = await performersFixture();
});
afterAll(async () => {
  await f?.close();
});

// A complete 0205-valid redemption is inserted locally; all production guards stay enabled.
async function forcedRedemption() {
  const source = await recorded(f, '25.000', '0.000');
  const type = ids.newId(),
    entitlement = ids.newId(),
    component = ids.newId(),
    slot = ids.newId(),
    redemption = ids.newId(),
    line = ids.newId();
  await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${f.company},${type},${f.business},${`Synthetic guarded package ${type}`},25.000,30)`;
  await f.h.owner.begin(async (tx) => {
    await tx`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,
      list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,sold_business_date,sold_timezone,
      recorded_by,recorded_by_membership_id,expires_on,refunded_amount,revision)
      VALUES(${f.company},${entitlement},${f.business},${f.customer},${type},'SOLD','Synthetic guarded package',30,25,25,0,0,'CASH',
      ${must(f.employees[0])},${f.branch},'2026-10-14T08:00:00Z','2026-10-14','Asia/Kuwait',${f.userId},${f.membership},'2026-11-13',0,1)`;
    await tx`INSERT INTO package_components(company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      SELECT company_id,${component},business_id,${entitlement},service_id,1,'Synthetic service',25,1,25 FROM service_lines WHERE company_id=${f.company} AND id=${source.lineId}`;
    await tx`INSERT INTO package_session_slots(company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES(${f.company},${slot},${f.business},${entitlement},${component},1,25,'FREE')`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,to_jsonb(l)||
      jsonb_build_object('id',${line}::text,'ordinal',2,'input_index',1,'redemption_id',${redemption}::text))).*
      FROM service_lines l WHERE company_id=${f.company} AND id=${source.lineId}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,to_jsonb(p)||
      jsonb_build_object('id',${ids.newId()}::text,'line_id',${line}::text))).*
      FROM line_performers p WHERE company_id=${f.company} AND line_id=${source.lineId}`;
    await tx`INSERT INTO package_redemptions(company_id,id,business_id,entitlement_id,component_id,slot_id,line_id,redeemed_at,recorded_by,recorded_by_membership_id)
      VALUES(${f.company},${redemption},${f.business},${entitlement},${component},${slot},${line},'2026-10-14T08:00:00Z',${f.userId},${f.membership})`;
    await tx`UPDATE package_session_slots SET state='USED',current_redemption_id=${redemption} WHERE company_id=${f.company} AND id=${slot}`;
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;
  });
  return { sessionId: source.sessionId, lineId: line, slot, redemption };
}

type Visit = Awaited<ReturnType<typeof forcedRedemption>>;
type Writer = 'edit' | 'cancel' | 'performers';
function write(kind: Writer, visit: Visit, revision = 1, userId = f.editorId) {
  if (kind === 'edit')
    return runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: revision }), {
      userId,
    });
  if (kind === 'cancel')
    return runCancel(
      f,
      visit.sessionId,
      visit.lineId,
      cancelInput({ expected_revision: revision }),
      { userId },
    );
  return runChange(
    f,
    visit.sessionId,
    visit.lineId,
    performersInput({
      expected_revision: revision,
      performers: [{ employee_id: must(f.employees[1]), share_bps: 10000 }],
    }),
    { userId },
  );
}

async function state(visit: Visit) {
  return f.h.owner`SELECT to_jsonb(l) AS line,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY performer_ordinal) FROM line_performers p WHERE p.company_id=l.company_id AND p.line_id=l.id) AS performers,
    (SELECT to_jsonb(s) FROM package_session_slots s WHERE s.company_id=l.company_id AND s.id=${visit.slot}) AS slot,
    (SELECT to_jsonb(r) FROM package_redemptions r WHERE r.company_id=l.company_id AND r.id=${visit.redemption}) AS redemption,
    (SELECT count(*)::int FROM service_line_edits e WHERE e.company_id=l.company_id AND e.line_id=l.id) AS edits,
    (SELECT count(*)::int FROM service_line_cancellations c WHERE c.company_id=l.company_id AND c.line_id=l.id) AS cancellations,
    (SELECT count(*)::int FROM service_line_performer_changes c WHERE c.company_id=l.company_id AND c.line_id=l.id) AS changes,
    (SELECT count(*)::int FROM audit_log a WHERE a.company_id=l.company_id AND a.entity_id=l.id) AS audits,
    (SELECT count(*)::int FROM idempotency_keys k WHERE k.company_id=l.company_id) AS keys,
    (SELECT count(*)::int FROM outbox o WHERE o.company_id=l.company_id AND o.aggregate_id=l.session_id) AS events
    FROM service_lines l WHERE l.company_id=${f.company} AND l.id=${visit.lineId}`;
}

const cases = [
  ['edit', 'SESSION_LINE_NOT_EDITABLE'],
  ['cancel', 'SESSION_LINE_NOT_CANCELLABLE'],
  ['performers', 'SESSION_LINE_PERFORMERS_NOT_CHANGEABLE'],
] as const;
it.each(cases)(
  '%s writer refuses a valid redeemed line with %s and leaves all state unchanged',
  async (kind, code) => {
    const visit = await forcedRedemption(),
      before = await state(visit);
    expect(before[0]).toMatchObject({
      line: { redemption_id: visit.redemption, status: 'ACTIVE', revision: 1 },
      slot: { state: 'USED', current_redemption_id: visit.redemption },
    });
    await expect(write(kind, visit)).rejects.toMatchObject({ code });
    expect(await state(visit)).toEqual(before);
  },
);
it.each(cases)('%s writer preserves stale-revision precedence on redeemed lines', async (kind) => {
  const visit = await forcedRedemption(),
    before = await state(visit);
  await expect(write(kind, visit, 2)).rejects.toMatchObject({
    code: 'SESSION_LINE_REVISION_STALE',
    details: { current_revision: 1 },
  });
  expect(await state(visit)).toEqual(before);
});
it.each(cases)(
  '%s writer checks authority before revealing the redeemed-line refusal',
  async (kind) => {
    const visit = await forcedRedemption(),
      before = await state(visit);
    await expect(write(kind, visit, 1, f.userId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await state(visit)).toEqual(before);
  },
);
it('redeemed price and performer no-op requests still return their package refusal', async () => {
  const visit = await forcedRedemption(),
    before = await state(visit);
  await expect(
    runEdit(
      f,
      visit.sessionId,
      visit.lineId,
      editBody({ discount: { kind: 'AMOUNT', amount: '0.000' } }),
    ),
  ).rejects.toMatchObject({ code: 'SESSION_LINE_NOT_EDITABLE' });
  await expect(
    runChange(
      f,
      visit.sessionId,
      visit.lineId,
      performersInput({ performers: [{ employee_id: must(f.employees[0]), share_bps: 10000 }] }),
    ),
  ).rejects.toMatchObject({ code: 'SESSION_LINE_PERFORMERS_NOT_CHANGEABLE' });
  expect(await state(visit)).toEqual(before);
});
