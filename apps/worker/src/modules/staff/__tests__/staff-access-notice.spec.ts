import { validInAppTemplate, type SafeParameter } from '@pospay/notifications';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import {
  grantedEvent,
  OCCURRED_AT,
  pinEvent,
  ROLE,
  staffAccessNoticeFixture,
  type Scope,
  type StaffAccessNoticeFixture,
} from './staff-access-notice.fixture.ts';

let f: StaffAccessNoticeFixture;
beforeAll(async () => {
  f = await staffAccessNoticeFixture();
});
afterAll(async () => {
  await f?.close();
});

interface World {
  readonly scope: Scope;
  readonly employeeId: string;
  readonly employeeUserId: string;
  readonly ownerUserId: string;
  readonly secondOwnerUserId: string;
  readonly managerUserId: string;
}

/** شركة جديدة لكل اختبار: صفحات الإشعارات ما تختلطش بين المواضع. */
async function world(label: string): Promise<World> {
  const scope = await f.newScope(label);
  const ownerUserId = await f.user(`Owner ${label}`);
  const secondOwnerUserId = await f.user(`Second owner ${label}`);
  const managerUserId = await f.user(`Manager ${label}`);
  const employeeUserId = await f.user(`Staff ${label}`);
  await f.member({
    scope,
    userId: ownerUserId,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: scope.company,
  });
  await f.member({
    scope,
    userId: secondOwnerUserId,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: scope.company,
  });
  await f.member({
    scope,
    userId: managerUserId,
    roleId: ROLE.general_manager,
    scopeType: 'COMPANY',
    scopeId: scope.company,
  });
  const employeeId = await f.employee(scope, {
    nameAr: 'سارة',
    nameEn: 'Sara',
    userId: employeeUserId,
  });
  return { scope, employeeId, employeeUserId, ownerUserId, secondOwnerUserId, managerUserId };
}

async function addFormerOwner(scope: Scope): Promise<string> {
  const userId = await f.user('Former owner');
  await f.member({
    scope,
    userId,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: scope.company,
    endsAt: '2026-06-01T00:00:00Z',
  });
  return userId;
}

const parametersOf = (payload: unknown): readonly SafeParameter[] =>
  (payload as { notification_recipients: { safe_parameters: readonly SafeParameter[] }[] })
    .notification_recipients[0]?.safe_parameters ?? [];

it('notifies every active canonical owner once about a granted staff access', async () => {
  const w = await world('granted');
  await addFormerOwner(w.scope);
  await f.employee(w.scope, { nameAr: 'هبة', nameEn: 'Heba', userId: w.managerUserId });
  const membershipId = await f.member({
    scope: w.scope,
    userId: w.managerUserId,
    roleId: ROLE.general_manager,
    scopeType: 'BUSINESS',
    scopeId: w.scope.business,
  });
  await f.grant({
    scope: w.scope,
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
    grantedBy: w.managerUserId,
    updatedAt: OCCURRED_AT,
  });
  const event = grantedEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });

  const notices = await f.notices(w.scope.company);
  expect(notices).toHaveLength(1);
  const recipients = (notices[0]?.['payload'] as { notification_recipients: { user_id: string }[] })
    .notification_recipients;
  expect(recipients.map((recipient) => recipient.user_id).sort()).toEqual(
    [w.ownerUserId, w.secondOwnerUserId].sort(),
  );
  const parameters = parametersOf(notices[0]?.['payload']);
  expect(parameters.map((parameter) => parameter.name)).toEqual([
    'employee_name_ar',
    'employee_name_en',
    'actor_name_ar',
    'actor_name_en',
    'branch_name_ar',
    'branch_name_en',
    'occurred_date',
    'occurred_time',
  ]);
  expect(parameters[0]?.value).toBe('سارة');
  expect(parameters[1]?.value).toBe('Sara');
  expect(parameters[2]?.value).toBe('هبة');
  expect(parameters[3]?.value).toBe('Heba');
  expect(parameters[4]?.value).toBe('Branch granted');
  expect(parameters[5]?.value).toBe('Branch granted');
  expect(parameters[6]?.value).toBe('2026-11-25');
  expect(parameters[7]?.value).toBe('09:30');
  expect(validInAppTemplate('staff_access_granted', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('staff_access_granted', 1, 'en', parameters)).toBe(true);
  const text = JSON.stringify(notices[0]?.['payload']);
  expect(text).not.toMatch(/pin_hash|pin\b/i);
  expect(text).not.toMatch(/\+?\b\d{9,}\b/);
}, 60_000);

it('names an owner actor without a linked employee by the owner role', async () => {
  const w = await world('owner actor');
  const membershipId = await f.member({
    scope: w.scope,
    userId: w.managerUserId,
    roleId: ROLE.general_manager,
    scopeType: 'COMPANY',
    scopeId: w.scope.company,
  });
  await f.grant({
    scope: w.scope,
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
    grantedBy: w.ownerUserId,
    updatedAt: OCCURRED_AT,
  });
  const event = grantedEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const notices = await f.notices(w.scope.company);
  const parameters = parametersOf(notices[0]?.['payload']);
  expect(parameters[2]?.value).toBe('المالك');
  expect(parameters[3]?.value).toBe('Owner');
}, 60_000);

it('notifies the owners about a PIN reset by somebody else', async () => {
  const w = await world('pin reset');
  await f.pin({
    scope: w.scope,
    userId: w.employeeUserId,
    setBy: w.managerUserId,
    setAt: OCCURRED_AT,
  });
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const notices = await f.notices(w.scope.company);
  expect(notices).toHaveLength(1);
  expect(notices[0]?.['event_type']).toBe('StaffPinSetByOtherNoticeRequested');
  const parameters = parametersOf(notices[0]?.['payload']);
  expect(parameters[0]?.value).toBe('سارة');
  expect(parameters[6]?.value).toBe('2026-11-25');
  expect(parameters[7]?.value).toBe('09:30');
  expect(validInAppTemplate('staff_pin_set_by_other', 1, 'ar', parameters)).toBe(true);
  expect(JSON.stringify(notices[0]?.['payload'])).not.toMatch(/\+?\b\d{9,}\b/);
}, 60_000);

it('resolves the resetting manager from the audit log when the employee already replaced her PIN', async () => {
  const w = await world('pin replaced');
  await f.pin({ scope: w.scope, userId: w.employeeUserId, setBy: null, setAt: OCCURRED_AT });
  await f.resetAudit({
    scope: w.scope,
    userId: w.employeeUserId,
    actorUserId: w.managerUserId,
    at: OCCURRED_AT,
  });
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const notices = await f.notices(w.scope.company);
  expect(notices).toHaveLength(1);
  const parameters = parametersOf(notices[0]?.['payload']);
  // المنفّذ مش موظفة مرتبطة، فاسمه دوره: «المدير». مفيش رقم سري ولا hash في الصف.
  expect(parameters[2]?.value).toBe('المدير');
  expect(parameters[3]?.value).toBe('Manager');
  expect(JSON.stringify(notices[0]?.['payload'])).not.toMatch(/pin_hash/i);
}, 60_000);

it('emits one notice only when the same event is delivered again', async () => {
  const w = await world('idempotent');
  await f.pin({
    scope: w.scope,
    userId: w.employeeUserId,
    setBy: w.managerUserId,
    setAt: OCCURRED_AT,
  });
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE consumer_id = 'staff.staff-access-notice-v1'`;
  expect(await f.deliver(event)).toEqual({ delivered: true });
  await f.db.withTenant(w.scope.company, (tx) => f.consumer.handle(tx, event));
  expect(await f.notices(w.scope.company)).toHaveLength(1);
}, 60_000);

it('stores the owner bell in the inbox and keeps it inside its own company', async () => {
  const w = await world('inbox');
  const other = f.scope('B');
  await f.pin({
    scope: w.scope,
    userId: w.employeeUserId,
    setBy: w.managerUserId,
    setAt: OCCURRED_AT,
  });
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const [notice] = await f.notices(w.scope.company);
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const deliver = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(
    await deliver({
      companyId: w.scope.company,
      id: String(notice?.['id']),
      aggregateType: 'staff_access_notice',
      aggregateId: w.employeeId,
      eventType: 'StaffPinSetByOtherNoticeRequested',
      payload: notice?.['payload'],
      attempt: 1,
    }),
  ).toEqual({ delivered: true });
  const stored = await f.inbox(w.scope.company);
  expect(stored).toHaveLength(2);
  expect(stored[0]).toMatchObject({
    recipient_user_id: w.ownerUserId,
    template_key: 'staff_pin_set_by_other',
    template_revision: 1,
    locale: 'ar',
    source_event_id: String(notice?.['id']),
  });
  expect(await f.inbox(other.company)).toHaveLength(0);
}, 60_000);

it('refuses a malformed staff access event and emits nothing', async () => {
  const w = await world('malformed');
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
  });
  const malformed = { ...event, payload: { employee_id: w.employeeId, user_id: w.employeeUserId } };
  const outcome = await f.deliver(malformed);
  expect(outcome.delivered).toBe(false);
  expect(await f.notices(w.scope.company)).toHaveLength(0);
}, 60_000);

it('keeps the actor and time stamped on a granted event after the access row changes', async () => {
  const w = await world('stamped grant');
  const membershipId = await f.member({
    scope: w.scope,
    userId: w.managerUserId,
    roleId: ROLE.general_manager,
    scopeType: 'COMPANY',
    scopeId: w.scope.company,
  });
  await f.grant({
    scope: w.scope,
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
    grantedBy: w.managerUserId,
    updatedAt: new Date('2026-11-26T10:00:00.000Z'),
  });
  await f.owner`UPDATE employee_staff_access SET state = 'STOPPED'
    WHERE company_id = ${w.scope.company} AND employee_id = ${w.employeeId}`;
  const event = grantedEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    membershipId,
    stamp: { actorUserId: w.ownerUserId, occurredAt: OCCURRED_AT },
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const parameters = parametersOf((await f.notices(w.scope.company))[0]?.['payload']);
  expect(parameters[2]?.value).toBe('المالك');
  expect(parameters[6]?.value).toBe('2026-11-25');
  expect(parameters[7]?.value).toBe('09:30');
}, 60_000);

it('keeps the actor and time stamped on a PIN event after another manager resets again', async () => {
  const w = await world('stamped pin');
  await f.pin({
    scope: w.scope,
    userId: w.employeeUserId,
    setBy: w.managerUserId,
    setAt: new Date('2026-11-26T10:00:00.000Z'),
  });
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    stamp: { actorUserId: w.ownerUserId, occurredAt: OCCURRED_AT },
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const parameters = parametersOf((await f.notices(w.scope.company))[0]?.['payload']);
  expect(parameters[2]?.value).toBe('المالك');
  expect(parameters[6]?.value).toBe('2026-11-25');
  expect(parameters[7]?.value).toBe('09:30');
}, 60_000);

it('still resolves a legacy event that omits the actor and time', async () => {
  const w = await world('legacy pin');
  await f.pin({
    scope: w.scope,
    userId: w.employeeUserId,
    setBy: w.managerUserId,
    setAt: OCCURRED_AT,
  });
  const event = pinEvent(f.ids, w.scope, { employeeId: w.employeeId, userId: w.employeeUserId });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const parameters = parametersOf((await f.notices(w.scope.company))[0]?.['payload']);
  expect(parameters[2]?.value).toBe('المدير');
  expect(parameters[7]?.value).toBe('09:30');
}, 60_000);

it('notifies the owners when an employee recovers her own PIN on StaffPinRecovered', async () => {
  const w = await world('recovered pin');
  const event = pinEvent(f.ids, w.scope, {
    employeeId: w.employeeId,
    userId: w.employeeUserId,
    eventType: 'StaffPinRecovered',
    stamp: { actorUserId: w.employeeUserId, occurredAt: OCCURRED_AT },
  });
  expect(await f.deliver(event)).toEqual({ delivered: true });
  const notices = await f.notices(w.scope.company);
  expect(notices).toHaveLength(1);
  expect(notices[0]?.['event_type']).toBe('StaffPinRecoveredNoticeRequested');
  const parameters = parametersOf(notices[0]?.['payload']);
  expect(parameters[0]?.value).toBe('سارة');
  expect(validInAppTemplate('staff_pin_recovered', 1, 'ar', parameters)).toBe(true);
  expect(validInAppTemplate('staff_pin_recovered', 1, 'en', parameters)).toBe(true);
}, 60_000);
