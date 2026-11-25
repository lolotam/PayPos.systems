import { editorLabel, safeDisplayName, t } from '@pospay/i18n';
import { expect, it } from 'vitest';

import type { StaffAccessNoticeFallback, StaffAccessNoticeKind } from '../../domain/staff-access-notice.ts';
import type {
  StaffAccessNoticeEvent,
  StaffAccessNoticePayload,
  StaffAccessNoticePorts,
} from '../../ports/staff-access-notice.port.ts';
import { RequestStaffAccessNotice } from './request-staff-access-notice.ts';

const BUSINESS = '01920000-0000-7000-8000-0000000000a1';
const BRANCH = '01920000-0000-7000-8000-0000000000b1';
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const USER = '01920000-0000-7000-8000-0000000000f1';
const SOURCE = '01920000-0000-7000-8000-0000000000c1';
const OCCURRED_AT = new Date('2026-11-25T06:30:00Z');

const fallback: StaffAccessNoticeFallback = {
  employee: { ar: t('ar', 'inApp.generic_employee'), en: t('en', 'inApp.generic_employee') },
  branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
  actor: { ar: t('ar', 'inApp.editor_generic'), en: t('en', 'inApp.editor_generic') },
  safeName: safeDisplayName,
  actorText: editorLabel,
};

type Appended = {
  readonly eventId: string;
  readonly employeeId: string;
  readonly kind: StaffAccessNoticeKind;
  readonly payload: StaffAccessNoticePayload;
};

function harness(overrides: Partial<StaffAccessNoticePorts> = {}) {
  const appended: Appended[] = [];
  const claims: string[] = [];
  let counter = 0;
  const ports: StaffAccessNoticePorts = {
    companyOpen: async () => true,
    owners: async () => ['owner-1'],
    place: async () => ({ nameAr: 'السالمية', nameEn: 'Salmiya', timeZone: 'Asia/Kuwait' }),
    readEmployee: async () => ({ businessId: BUSINESS, nameAr: 'سارة', nameEn: 'Sara' }),
    readActorRecord: async () => ({ actorUserId: USER, occurredAt: OCCURRED_AT }),
    readActorProfile: async () => ({
      nameAr: 'هبة',
      nameEn: 'Heba',
      role: 'owner',
      roleIsSystem: true,
      roleNameAr: 'المالك',
      roleNameEn: 'Owner',
    }),
    claim: async (sourceEventId) => {
      claims.push(sourceEventId);
      return true;
    },
    outbox: {
      append: async (eventId, employeeId, kind, payload) => {
        appended.push({ eventId, employeeId, kind, payload });
      },
    },
    ...overrides,
  };
  const ids = { newId: () => `01920000-0000-7000-8000-00000000000${counter++}` };
  return {
    appended,
    claims,
    useCase: new RequestStaffAccessNotice(ports, ids, { now: () => OCCURRED_AT }, fallback),
  };
}

const event = (kind: StaffAccessNoticeKind): StaffAccessNoticeEvent => ({
  kind,
  companyId: BUSINESS,
  sourceEventId: SOURCE,
  employeeId: EMPLOYEE,
  userId: USER,
  branchId: BRANCH,
});

it.each(['staff_access_granted', 'staff_pin_set_by_other'] as const)(
  'requests one owner bell for the %s event',
  async (kind) => {
    const h = harness();
    await h.useCase.execute(event(kind));
    expect(h.appended).toHaveLength(1);
    const row = h.appended[0];
    expect(row?.kind).toBe(kind);
    expect(row?.employeeId).toBe(EMPLOYEE);
    expect(row?.payload.business_id).toBe(BUSINESS);
    expect(row?.payload.branch_id).toBe(BRANCH);
    expect(row?.payload.employee_id).toBe(EMPLOYEE);
    expect(row?.payload.notification_recipients).toHaveLength(1);
    expect(row?.payload.notification_recipients[0]).toMatchObject({
      channel: 'IN_APP',
      user_id: 'owner-1',
      locale: 'ar',
      template_key: kind,
      template_revision: 1,
    });
    expect(row?.payload.notification_recipients[0]?.safe_parameters).toEqual([
      { name: 'employee_name_ar', type: 'text', value: 'سارة' },
      { name: 'employee_name_en', type: 'text', value: 'Sara' },
      { name: 'actor_name_ar', type: 'text', value: 'هبة' },
      { name: 'actor_name_en', type: 'text', value: 'Heba' },
      { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
      { name: 'occurred_date', type: 'text', value: '2026-11-25' },
      { name: 'occurred_time', type: 'text', value: '09:30' },
    ]);
  },
);

it('splits the owners into groups of a hundred', async () => {
  const owners = Array.from({ length: 150 }, (_, index) => `owner-${index}`);
  const h = harness({ owners: async () => owners });
  await h.useCase.execute(event('staff_access_granted'));
  expect(h.appended).toHaveLength(2);
  expect(h.appended[0]?.payload.notification_recipients).toHaveLength(100);
  expect(h.appended[1]?.payload.notification_recipients).toHaveLength(50);
});

it('emits nothing when the event was already claimed', async () => {
  const h = harness({ claim: async () => false });
  await h.useCase.execute(event('staff_access_granted'));
  expect(h.appended).toHaveLength(0);
});

it('emits nothing when the company has no owner or the branch is gone', async () => {
  const withoutOwners = harness({ owners: async () => [] });
  await withoutOwners.useCase.execute(event('staff_access_granted'));
  expect(withoutOwners.appended).toHaveLength(0);
  const withoutBranch = harness({ place: async () => null });
  await withoutBranch.useCase.execute(event('staff_access_granted'));
  expect(withoutBranch.appended).toHaveLength(0);
});

it('emits nothing for a closed company and never claims the event', async () => {
  const h = harness({ companyOpen: async () => false });
  await h.useCase.execute(event('staff_access_granted'));
  expect(h.appended).toHaveLength(0);
  expect(h.claims).toHaveLength(0);
});

it('refuses a missing employee or a missing actor before claiming the event', async () => {
  const withoutEmployee = harness({ readEmployee: async () => null });
  await expect(withoutEmployee.useCase.execute(event('staff_access_granted'))).rejects.toThrow(
    'STAFF_ACCESS_EVENT_INVALID',
  );
  expect(withoutEmployee.claims).toHaveLength(0);
  expect(withoutEmployee.appended).toHaveLength(0);
  const withoutActor = harness({ readActorRecord: async () => null });
  await expect(withoutActor.useCase.execute(event('staff_pin_set_by_other'))).rejects.toThrow(
    'STAFF_ACCESS_EVENT_INVALID',
  );
  expect(withoutActor.claims).toHaveLength(0);
  expect(withoutActor.appended).toHaveLength(0);
});

it('names the actor by a safe role label when the stored name is unsafe', async () => {
  const h = harness({
    readActorProfile: async () => ({
      nameAr: '123456',
      nameEn: '+96500000001',
      role: 'owner',
      roleIsSystem: true,
      roleNameAr: null,
      roleNameEn: null,
    }),
  });
  await h.useCase.execute(event('staff_access_granted'));
  const parameters = h.appended[0]?.payload.notification_recipients[0]?.safe_parameters ?? [];
  expect(parameters[2]?.value).toBe('المالك');
  expect(parameters[3]?.value).toBe('Owner');
});

it('names an actor without a name and without a role as a generic user', async () => {
  const h = harness({ readActorProfile: async () => null });
  await h.useCase.execute(event('staff_access_granted'));
  const parameters = h.appended[0]?.payload.notification_recipients[0]?.safe_parameters ?? [];
  expect(parameters[2]?.value).toBe('مستخدم');
  expect(parameters[3]?.value).toBe('User');
});

it('never puts a PIN, a phone or a token in the bell payload', async () => {
  const h = harness({
    readEmployee: async () => ({ businessId: BUSINESS, nameAr: 'سارة', nameEn: 'Sara' }),
  });
  await h.useCase.execute(event('staff_pin_set_by_other'));
  const payload = h.appended[0]?.payload;
  const names =
    payload?.notification_recipients.flatMap((recipient) =>
      recipient.safe_parameters.map((parameter) => parameter.name),
    ) ?? [];
  expect(names).not.toContain('pin');
  expect(names).not.toContain('phone');
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/\+?\b\d{9,}\b/);
  expect(text).not.toMatch(/pin_hash|token|bearer/);
});
