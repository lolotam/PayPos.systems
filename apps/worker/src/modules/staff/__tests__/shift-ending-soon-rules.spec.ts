import { effectiveAlertRule, type EffectiveAlertRule } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { clearRules, setMaster } from './alert-rule.helpers.ts';
import { ROLE } from './not-clocked-in.fixture.ts';
import type { ShiftEndingSoonTransactions } from '../ports/shift-ending-soon.port.ts';
import {
  ENDS_SOON_REMIND_AT,
  shiftEndingSoonFixture,
  type ShiftEndingSoonFixture,
} from './shift-ending-soon.fixture.ts';

let f: ShiftEndingSoonFixture;
beforeAll(async () => {
  f = await shiftEndingSoonFixture();
});
afterAll(async () => {
  await f?.close();
});

const KIND = 'SHIFT_ENDS_SOON';

/** موظفة شغالة في فرعها: حساب مرتبط بعضوية سارية، ووردية، وبصمة مفتوحة. */
async function atWork() {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  return { tenant, employee };
}

/** موظفة ليها حساب مرتبط ووردية، من غير أي بصمة مفتوحة. */
async function linkedWithoutSession(name = 'Quiet') {
  const tenant = await f.tenant();
  const userId = await f.user(`${name}-user`);
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { userId, nameEn: name });
  await f.shift(tenant, employee);
  return { tenant, employee };
}

/**
 * بورت بيرجع قاعدة ثابتة في القراءة المفتوحة؛ القراءة تحت القفل بتوصل القاعدة المخزنة الحقيقية.
 * ده بيفصل الكاش عن القرار: القاعدة اللي شافها الكاش مش هي اللي بتقرر (ADR-0053 قرار 2).
 */
function withRule(rule: EffectiveAlertRule): ShiftEndingSoonTransactions {
  return {
    candidates: f.endsSoonTransactions.candidates,
    rule: async () => rule,
    run: (company, employeeId, sample, work) =>
      f.endsSoonTransactions.run(company, employeeId, sample, work),
  };
}

it('SEN-06 approved leave reaching the shift end excuses, a pending one does not', async () => {
  const excused = await atWork();
  const pending = await atWork();
  const early = await atWork();
  const fullDay = await atWork();
  const span = {
    kind: 'PARTIAL' as const,
    from: '2026-10-04',
    to: '2026-10-04',
    start: '16:00',
    end: '18:00',
    startsAt: new Date('2026-10-04T13:00:00.000Z'),
    endsAt: new Date('2026-10-04T15:00:00.000Z'),
  };
  await f.leave(excused.tenant, excused.employee, { ...span, status: 'APPROVED' });
  await f.leave(pending.tenant, pending.employee, { ...span, status: 'PENDING' });
  await f.leave(early.tenant, early.employee, {
    ...span,
    status: 'APPROVED',
    end: '17:00',
    endsAt: new Date('2026-10-04T14:00:00.000Z'),
  });
  await f.leave(fullDay.tenant, fullDay.employee, {
    kind: 'FULL_DAY',
    status: 'APPROVED',
    from: '2026-10-04',
    to: '2026-10-04',
    start: null,
    end: null,
    startsAt: new Date('2026-10-03T21:00:00.000Z'),
    endsAt: new Date('2026-10-04T21:00:00.000Z'),
  });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(excused.tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(excused.tenant.company, excused.employee)).toHaveLength(0);
  expect(await f.detectEndsSoon().execute(fullDay.tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(fullDay.tenant.company, fullDay.employee)).toHaveLength(0);
  expect(await f.detectEndsSoon().execute(pending.tenant.company)).toEqual({ notified: 1 });
  expect(await f.detectEndsSoon().execute(early.tenant.company)).toEqual({ notified: 1 });
  expect(f.endsSoonFailures).toEqual([]);
});

it('the locked read decides: a pre-filter that sees the rule on still suppresses an off rule', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: false });
  f.setNow(ENDS_SOON_REMIND_AT);
  const port = withRule(effectiveAlertRule('SHIFT_ENDS_SOON', null, null, null));
  expect(await f.detectEndsSoon(port).execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await f.endingNotices(tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
});

it('the locked read decides: a pre-filter that sees the rule off still reminds an on rule', async () => {
  const { tenant, employee } = await atWork();
  f.setNow(ENDS_SOON_REMIND_AT);
  const port = withRule(
    effectiveAlertRule(
      'SHIFT_ENDS_SOON',
      { enabled: false, recipientRoles: [], channels: [], delayMinutes: null, leadMinutes: 30 },
      null,
      null,
    ),
  );
  expect(await f.detectEndsSoon(port).execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 1, suppressed_at: null });
  expect(await f.endingEvents(tenant.company)).toHaveLength(1);
});

it('SEN-09 the kind switched off writes one suppressed row and sends nothing', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: false });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await f.endingNotices(tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
  expect(await f.audit(tenant.company, String(rows[0]?.['id']))).toHaveLength(0);
});

it('SEN-09 switching the kind back on never back-fills the suppressed row', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: false });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  await clearRules(f.ruleContext, tenant, KIND);
  await f.endsSoonRule(tenant, { enabled: true });
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
});

it('SEN-09 the suppressed row is written even for an employee with no open session', async () => {
  const { tenant, employee } = await linkedWithoutSession('Absent');
  await f.endsSoonRule(tenant, { enabled: false });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await f.endingNotices(tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
});

it('SEN-09 the master switch off suppresses the reminder the same way', async () => {
  const { tenant, employee } = await atWork();
  await setMaster(f.ruleContext, tenant, false);
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await f.endingNotices(tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
});

it('SEN-10 a branch override with a 45 minute lead moves the moment to 14:15', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: true, leadMinutes: 45, branchId: tenant.branch });
  f.setNow(new Date('2026-10-04T14:14:59.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(0);
  f.setNow(new Date('2026-10-04T14:15:00.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T14:15:00.000Z',
  );
});

it('SEN-10 a business rule with a 45 minute lead moves the moment the same way', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: true, leadMinutes: 45 });
  f.setNow(new Date('2026-10-04T14:14:59.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  f.setNow(new Date('2026-10-04T14:15:00.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T14:15:00.000Z',
  );
});

it('SEN-10 a rule with no stored lead uses the kind default of thirty minutes', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: true });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    ENDS_SOON_REMIND_AT.toISOString(),
  );
});

it('a lead longer than the shift reminds from the shift start', async () => {
  const { tenant, employee } = await atWork();
  await f.endsSoonRule(tenant, { enabled: true, leadMinutes: 600 });
  f.setNow(new Date('2026-10-04T07:30:00.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T07:00:00.000Z',
  );
  expect(f.endsSoonFailures).toEqual([]);
});
