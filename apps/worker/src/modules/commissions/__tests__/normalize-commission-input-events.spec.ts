import type { SalaryChanged, SessionTipsChanged } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { describe, expect, it } from 'vitest';

import { affectedCommissionTipEmployees } from '../domain/commission-tip-salary-periods.ts';
import { reduceCommissionTips } from '../domain/commission-tip-salary-inputs.ts';
import { CommissionTipSalaryInputInvalidError } from '../domain/errors.ts';
import { normalizeSalaryEvent } from '../use-cases/project-salary/project-salary.ts';
import { normalizeSessionTipsEvent } from '../use-cases/project-session-tips/project-session-tips.ts';

const EMPLOYEE = '01920000-0000-7000-8000-000000000ca1';
const SECOND = '01920000-0000-7000-8000-000000000cb2';
const SESSION = '01920000-0000-7000-8000-00000000d401';
const COMPANY = '01920000-0000-7000-8000-000000000c01';
const BUSINESS = '01920000-0000-7000-8000-000000000b01';
const BRANCH = '01920000-0000-7000-8000-000000000b02';
const ids = [
  ['lower-case', (id: string) => id],
  ['upper-case', (id: string) => id.toUpperCase()],
] as const;

const alternating = (id: string): string =>
  [...id].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char)).join('');

const salaryPayload = (employeeId: string, businessId: string | null = BUSINESS): SalaryChanged =>
  ({
    employee_id: employeeId,
    ...(businessId === null ? {} : { business_id: businessId }),
    effective_from: '2026-11-01',
    amount: '500.000',
    revision: 1,
  }) as SalaryChanged;

const tipsPayload = (employeeIds: readonly string[]): SessionTipsChanged =>
  ({
    session_id: SESSION,
    business_id: BUSINESS,
    branch_id: BRANCH,
    business_date: '2026-11-01',
    revision: 1,
    tips: employeeIds.map((employee_id) => ({ employee_id, method: 'CARD', amount: '4.000' })),
  }) as SessionTipsChanged;

const envelope = (aggregateType: string, aggregateId: string) => ({
  companyId: COMPANY,
  id: '01920000-0000-7000-8000-000000000e01',
  aggregateType,
  aggregateId,
});

describe('normalizeSalaryEvent', () => {
  it.each(ids)('keeps the canonical lower-case employee id from a %s payload', (_name, variant) => {
    const input = normalizeSalaryEvent(
      envelope('employee', variant(EMPLOYEE)),
      salaryPayload(variant(EMPLOYEE)),
    );

    expect(input.employeeId).toBe(EMPLOYEE);
  });

  it('accepts an aggregate id that differs from the payload only by letter case', () => {
    const input = normalizeSalaryEvent(
      envelope('employee', EMPLOYEE),
      salaryPayload(EMPLOYEE.toUpperCase()),
    );

    expect(input.employeeId).toBe(EMPLOYEE);
  });

  it('lower-cases the business id of an upper-case payload', () => {
    const input = normalizeSalaryEvent(
      envelope('employee', EMPLOYEE),
      salaryPayload(EMPLOYEE, BUSINESS.toUpperCase()),
    );

    expect(input.businessId).toBe(BUSINESS);
  });

  it('keeps an absent business id as null and still lower-cases a mixed-case employee id', () => {
    const input = normalizeSalaryEvent(
      envelope('employee', EMPLOYEE),
      salaryPayload(alternating(EMPLOYEE), null),
    );

    expect([input.businessId, input.employeeId]).toEqual([null, EMPLOYEE]);
  });

  it('still refuses an aggregate that is another employee', () => {
    expect(() =>
      normalizeSalaryEvent(envelope('employee', SECOND), salaryPayload(EMPLOYEE)),
    ).toThrow(CommissionTipSalaryInputInvalidError);
  });
});

describe('normalizeSessionTipsEvent', () => {
  it.each(ids)(
    'lower-cases every tip entry of a %s payload and keeps its method and amount',
    (_name, variant) => {
      const input = normalizeSessionTipsEvent(
        envelope('service_session', SESSION),
        tipsPayload([variant(EMPLOYEE), variant(SECOND)]),
      );

      expect(input.tips).toEqual([
        { employeeId: EMPLOYEE, method: 'CARD', amount: '4.000' },
        { employeeId: SECOND, method: 'CARD', amount: '4.000' },
      ]);
    },
  );

  it('lower-cases an id that is mixed-case inside one entry among several entries', () => {
    const input = normalizeSessionTipsEvent(
      envelope('service_session', SESSION),
      tipsPayload([alternating(EMPLOYEE), SECOND.toUpperCase(), alternating(SECOND)]),
    );

    expect(input.tips.map((tip) => tip.employeeId)).toEqual([EMPLOYEE, SECOND, SECOND]);
  });

  it('lower-cases a mixed payload entry by entry', () => {
    const input = normalizeSessionTipsEvent(
      envelope('service_session', SESSION),
      tipsPayload([EMPLOYEE.toUpperCase(), SECOND]),
    );

    expect(input.tips.map((tip) => tip.employeeId)).toEqual([EMPLOYEE, SECOND]);
  });

  it('still refuses a session aggregate that is another session', () => {
    expect(() =>
      normalizeSessionTipsEvent(envelope('service_session', EMPLOYEE), tipsPayload([EMPLOYEE])),
    ).toThrow(CommissionTipSalaryInputInvalidError);
  });

  it('yields one employee and period pair when the stored row and the event row differ by case', () => {
    const input = normalizeSessionTipsEvent(
      envelope('service_session', SESSION),
      tipsPayload([EMPLOYEE.toUpperCase()]),
    );
    const outcome = reduceCommissionTips([], input);
    if (!outcome.applied || outcome.session === null) throw new Error('event not applied');
    const held = {
      period: '2026-11',
      rows: [{ employeeId: EMPLOYEE, method: 'CARD' as const, amount: parseMoney('3.000') }],
    };

    expect(affectedCommissionTipEmployees(held, outcome.session, ['2026-11'])).toEqual([
      { period: '2026-11', employeeId: EMPLOYEE },
    ]);
  });
});
