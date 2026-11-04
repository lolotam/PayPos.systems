import { expect, it } from 'vitest';
import { appendServiceSessionLinesInput, packageSessionLineInput, recordServiceSessionInput, recordedServiceLine,
  serviceLineChanged, serviceSessionLinesAdded, serviceSessionRecorded, sessionLineDraft } from './service-session.js';

const id='01920000-0000-7000-8000-000000004001';
const draft={ service_id:id,package:{ entitlement_id:id },performers:[{ employee_id:id }] };
const paid={ service_id:id,price:'1.000',discount:{ kind:'AMOUNT',amount:'0.000' },performers:draft.performers,discount_proposal_id:id };
it('accepts strict standalone package and paid drafts, while routes remain paid-only', () => {
  expect(sessionLineDraft.parse(draft)).toEqual(draft);
  expect(sessionLineDraft.parse(paid)).toEqual(paid);
  for (const schema of [recordServiceSessionInput,appendServiceSessionLinesInput]) {
    const body=schema === recordServiceSessionInput ? { customer_id:id,lines:[draft] } : { lines:[draft] };
    expect(schema.safeParse(body).success).toBe(false);
  }
});
it.each([{ price:'1.000' },{ discount:{ kind:'AMOUNT',amount:'0.000' } },{ discount_proposal_id:id },
  { package:{ entitlement_id:id,component_id:id } },{ package:{ entitlement_id:id,ordinal:1 } },{ extra:true }])('refuses mixed or extra package draft %j', (extra) => {
  expect(packageSessionLineInput.safeParse({ ...draft,...extra }).success).toBe(false);
  expect(sessionLineDraft.safeParse({ ...draft,...extra }).success).toBe(false);
});
const line={ line_id:id,session_id:id,service_id:id,branch_id:id,business_id:id,customer_id:id,status:'ACTIVE',
  occurred_at:'2026-11-05T00:00:00.000Z',recorded_at:'2026-11-05T00:00:00.000Z',business_date:'2026-11-05',late:false,
  recorded_by:id,recorded_by_membership_id:id,list_price:'1.001',price:'1.001',discount:'0.000',net:'1.001',
  performers:[{ employee_id:id,share_bps:10000 }],rule_snapshot:{ kind:'ZERO' },counts_snapshot:true,
  package:{ entitlement_id:id,component_id:id,ordinal:1 },revision:1 };
const envelope={ schema_version:1,session_id:id,business_id:id,branch_id:id,customer_id:id,
  occurred_at:line.occurred_at,recorded_at:line.recorded_at,business_date:line.business_date,business_timezone:'Asia/Kuwait',
  late:false,recorded_by:id,recorded_by_membership_id:id,lines:[line] };
it.each([null,line.package])('all three event contracts accept package %j without rewriting old bodies', (pkg) => {
  const snapshot={ ...line,package:pkg }, body={ ...envelope,lines:[snapshot] };
  expect(serviceLineChanged.parse(snapshot)).toEqual(snapshot);
  expect(serviceSessionRecorded.parse(body)).toEqual(body);
  expect(serviceSessionLinesAdded.parse(body)).toEqual(body);
});
it.each([{ ordinal:0 },{ ordinal:366 },{ ordinal:1.5 },{ extra:true },{ component_id:'invalid' }])('rejects malformed package event %j', (extra) => {
  expect(serviceLineChanged.safeParse({ ...line,package:{ ...line.package,...extra } }).success).toBe(false);
});
const change={ kind:'LINE_CANCELLED',changed_at:line.recorded_at,changed_by:id,changed_by_membership_id:id,
  previous:{ revision:1,price:'1.001',discount:'0.000',net:'1.001' } };
it('preserves cancellation/performer revision rules and refuses package price edits', () => {
  expect(serviceLineChanged.safeParse({ ...line,status:'CANCELLED',revision:2,change }).success).toBe(true);
  expect(serviceLineChanged.safeParse({ ...line,revision:2,change:{ ...change,kind:'PRICE_DISCOUNT_EDIT' } }).success).toBe(false);
  expect(serviceLineChanged.safeParse({ ...line,status:'CANCELLED',revision:3,change }).success).toBe(false);
  expect(serviceLineChanged.safeParse({ ...line,revision:2,change:{ ...change,kind:'PERFORMERS_CHANGE',previous:{ revision:1,performers:line.performers } } }).success).toBe(true);
  for (const extra of [{ change },{ revision:2 },{ status:'CANCELLED' }]) {
    expect(recordedServiceLine.safeParse({ ...line,...extra }).success).toBe(false);
    expect(serviceSessionRecorded.safeParse({ ...envelope,lines:[{ ...line,...extra }] }).success).toBe(false);
    expect(serviceSessionLinesAdded.safeParse({ ...envelope,lines:[{ ...line,...extra }] }).success).toBe(false);
  }
});
