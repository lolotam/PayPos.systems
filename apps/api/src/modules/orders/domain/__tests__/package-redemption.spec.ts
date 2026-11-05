import { expect, it } from 'vitest';
import { assertPackageNotExpired, assertPackageNotYetValid, assertPackageRedemptionAllowed, assignPackageSlots,
  preparePackageSessionLine, prepareVisitLines, type PackagePreparedDraft } from '../package-redemption.ts';
import { sessionPreparationFacts } from '../prepare-session-lines.ts';
import type { SessionDraft, SessionEmployee, SessionService } from '../session-types.ts';

const employee: SessionEmployee = { id: 'employee', name_en: 'Synthetic', name_ar: null, user_id: null, eligible: true, clocked_in: false, approved_leave: true };
const other: SessionEmployee = { ...employee, id: 'other' };
const service: SessionService = { id: 'service', name_en: 'Synthetic', name_ar: null, price: 7125n, rule: { kind: 'FIXED', value: 2500n }, counts: true, revision: 2 };
const facts = sessionPreparationFacts([service], [employee, other], 'recorder');
const soldAt = new Date('2026-10-02T00:10:00Z');
const visit = new Date('2026-10-02T00:15:00Z');

const redemption = { id: 'redemption', entitlement_id: 'entitlement', component_id: 'component', slot_id: 'slot', ordinal: 1 };
const draft = (input_index: number): PackagePreparedDraft => ({ input_index, service_id: 'service', entitlement_id: 'entitlement',
  performers: [{ employee_id: 'employee' }], unit_value: 2250n, redemption });

it('the expiry compares the visit date, so the last day redeems and the next day is expired', () => {
  expect(() => assertPackageNotExpired('2026-12-30', '2026-12-30')).not.toThrow();
  expect(() => assertPackageNotExpired('2026-12-31', '2026-12-30')).toThrow('PACKAGE_EXPIRED');
});

it('a visit inside the window redeems even when it is recorded later', () => {
  expect(() => assertPackageRedemptionAllowed({ expiresOn: '2026-12-30', soldAt }, '2026-12-29', visit)).not.toThrow();
});

it('the lower bound compares instants, so a visit before the sale is refused whatever the local dates say', () => {
  expect(() => assertPackageNotYetValid(new Date('2026-10-02T00:04:00Z'), soldAt)).toThrow('PACKAGE_NOT_YET_VALID');
  expect(() => assertPackageNotYetValid(new Date('2026-10-02T00:10:00Z'), soldAt)).not.toThrow();
  expect(() => assertPackageNotYetValid(new Date('2026-09-30T23:00:00Z'), soldAt)).toThrow('PACKAGE_NOT_YET_VALID');
});

it('an imported entitlement has no lower bound', () => {
  expect(() => assertPackageNotYetValid(new Date('2020-01-01T00:00:00Z'), null)).not.toThrow();
});

it('a serving branch one day behind the selling branch still redeems inside the window', () => {
  expect(() => assertPackageRedemptionAllowed({ expiresOn: '2026-12-30', soldAt }, '2026-10-01', visit)).not.toThrow();
  expect(() => assertPackageRedemptionAllowed({ expiresOn: '2026-12-30', soldAt }, '2027-01-05', visit)).toThrow('PACKAGE_EXPIRED');
});

it('the lowest free slot is taken and two drafts of one component take k and k+1', () => {
  const slots = new Map([['component', [{ id: 'slot-1', ordinal: 1, unit_value: 2250n }, { id: 'slot-2', ordinal: 2, unit_value: 2250n }]]]);
  const assigned = assignPackageSlots([
    { input_index: 0, service_id: 'service', entitlement_id: 'entitlement', performers: [], component_id: 'component' },
    { input_index: 1, service_id: 'service', entitlement_id: 'entitlement', performers: [], component_id: 'component' },
  ], slots);
  expect(assigned.get(0)).toEqual({ id: 'slot-1', ordinal: 1, unit_value: 2250n });
  expect(assigned.get(1)).toEqual({ id: 'slot-2', ordinal: 2, unit_value: 2250n });
});

it('a component without a free slot refuses the whole request', () => {
  expect(() => assignPackageSlots([
    { input_index: 0, service_id: 'service', entitlement_id: 'entitlement', performers: [], component_id: 'component' },
  ], new Map())).toThrow('PACKAGE_NO_FREE_SESSION');
});

it('the redeemed line carries the slot value with no discount and no effective bps', () => {
  expect(preparePackageSessionLine(draft(0), facts)).toMatchObject({ input_index: 0, list_price: 2250n, price: 2250n,
    discount: 0n, net: 2250n, effective_discount_bps: 0, redemption });
});

it('the package line keeps the performer rules, the warnings and the self rule', () => {
  expect(() => preparePackageSessionLine({ ...draft(0), performers: [{ employee_id: 'missing' }] }, facts)).toThrow('SESSION_PERFORMER_NOT_ELIGIBLE');
  const self = { ...employee, id: 'self', user_id: 'recorder' };
  expect(() => preparePackageSessionLine({ ...draft(0), performers: [{ employee_id: 'self' }] },
    sessionPreparationFacts([service], [self], 'recorder'))).toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  expect(() => preparePackageSessionLine({ ...draft(0), service_id: 'missing' }, facts)).toThrow('SESSION_SERVICE_NOT_FOUND');
});

it('paid and package lines are prepared in request order', () => {
  const paid: SessionDraft = { input_index: 2, service_id: 'service', price: 7125n, discount: { kind: 'AMOUNT', amount: 0n }, performers: [{ employee_id: 'other' }] };
  const prepared = prepareVisitLines([paid], [draft(0)], facts);
  expect(prepared.map((line) => line.input_index)).toEqual([0, 2]);
  expect(prepared.map((line) => line.net)).toEqual([2250n, 7125n]);
});
