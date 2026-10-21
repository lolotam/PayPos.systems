import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { SYSTEM_ROLES } from '@pospay/db';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeEvents,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { linkEmployee } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { attendanceChangeAlertRule } from '../persistence/attendance-change-alert-rule.adapter.ts';

let f: ChangeFixture;
let customRoleId: string;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  customRoleId = leaveIds.newId();
  await f.h.owner`INSERT INTO roles (id,company_id,code,name_en)
    VALUES (${customRoleId},${f.company},'synthetic_attendance_approver','Synthetic attendance approver')`;
  await f.h.owner`INSERT INTO role_permissions (role_id,role_owner_key,company_id,permission_code)
    VALUES (${customRoleId},${f.company},${f.company},'decide:attendance-change:company')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const file = (employeeId = f.employee.id, userId = f.approverId) =>
  f.fileChange.execute(changeActor(f, undefined, userId), {
    ...changeInput(f),
    employee_id: employeeId,
  });
const approve = (id: string) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision: 0 });
const outbox = (id: string) => changeEvents(f, id);
const recipients = async (id: string, eventType: string) =>
  (await changeEvents(f, id))
    .filter((event) => event['event_type'] === eventType)
    .flatMap((event) =>
      (event['payload'].notification_recipients ?? []).map((r: { user_id: string }) => r.user_id),
    );
const saveRule = async (kind: string, enabled: boolean, branchId: string | null = null) => {
  await f.h.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,delay_minutes,lead_minutes,updated_by,revision)
    VALUES (${f.company},${leaveIds.newId()},${f.business},${branchId},${kind},${enabled},ARRAY[]::text[],ARRAY['IN_APP']::text[],NULL,NULL,${f.owner},1)`;
};
const clearRules = () =>
  f.h.owner`DELETE FROM alert_rules WHERE company_id=${f.company} AND business_id=${f.business}`;
const setMaster = async (enabled: boolean | null) => {
  await f.h.owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES (${f.company},${f.business},${enabled})
    ON CONFLICT (company_id,business_id) DO UPDATE SET alerts_enabled=EXCLUDED.alerts_enabled`;
};
const newUser = async (email: string) => {
  await f.h.signedInOperator(email);
  const [row] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  return row?.['id'] as string;
};
const membership = async (userId: string, roleId: string, roleOwnerKey: string) => {
  const id = leaveIds.newId();
  await f.h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${f.company},${id},${userId},${roleId},${roleOwnerKey},'COMPANY',${f.company},'2026-01-01')`;
  return id;
};
const override = async (membershipId: string, permission: string, effect: 'ALLOW' | 'DENY') => {
  await f.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${leaveIds.newId()},${membershipId},${permission},${effect},'COMPANY',${f.company},'Synthetic delegation',${f.owner})`;
};
const personalAllow = async (email: string) => {
  const userId = await newUser(email);
  const memberId = await membership(
    userId,
    SYSTEM_ROLES.find((role) => role.code === 'staff')?.id as string,
    'global',
  );
  await override(memberId, 'decide:attendance-change:company', 'ALLOW');
  await override(memberId, 'request:attendance-change:branch', 'ALLOW');
  return userId;
};
const customRoleHolder = async (email: string, deny = false) => {
  const userId = await newUser(email);
  const memberId = await membership(userId, customRoleId, f.company);
  if (deny) await override(memberId, 'decide:attendance-change:company', 'DENY');
  return userId;
};
const employeeAt = async (branchId: string, userId: string | null = null) => {
  const id = await linkEmployee(f, userId);
  await f.h.owner`UPDATE employees SET primary_branch_id=${branchId} WHERE company_id=${f.company} AND id=${id}`;
  return id;
};

it('62-2b: a switched-off kind keeps the event and drops its recipients', async () => {
  await saveRule('ATTENDANCE_CHANGE_REQUESTED', false);
  try {
    const request = await file();
    const rows = await outbox(request.id);
    expect(rows).toMatchObject([{ event_type: 'AttendanceChangeRequested' }]);
    expect(rows[0]?.['payload']).toMatchObject({ request_id: request.id, kind: 'ADD_SESSION' });
    expect(rows[0]?.['payload']).not.toHaveProperty('notification_recipients');
  } finally {
    await clearRules();
  }
});

it('62-2b: a switched-off decision kind drops the decision notice only', async () => {
  await saveRule('ATTENDANCE_CHANGE_DECIDED', false);
  try {
    const request = await file();
    await approve(request.id);
    const rows = await outbox(request.id);
    expect(rows.map((row) => row['event_type'])).toEqual([
      'AttendanceChangeRequested',
      'AttendanceChangeDecided',
    ]);
    expect(await recipients(request.id, 'AttendanceChangeRequested')).toEqual([f.owner]);
    expect(rows[1]?.['payload']).not.toHaveProperty('notification_recipients');
  } finally {
    await clearRules();
  }
});

it('62-2b: the master switch stops both kinds', async () => {
  await setMaster(false);
  try {
    const request = await file();
    await approve(request.id);
    const rows = await outbox(request.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row['payload']).not.toHaveProperty('notification_recipients');
  } finally {
    await setMaster(null);
  }
});

it('62-2b: a branch override switches the kind off for its branch only', async () => {
  await saveRule('ATTENDANCE_CHANGE_REQUESTED', true);
  await saveRule('ATTENDANCE_CHANGE_REQUESTED', false, f.branch);
  try {
    const here = await file();
    const elsewhere = await file(await employeeAt(f.secondBranch));
    expect(await recipients(here.id, 'AttendanceChangeRequested')).toEqual([]);
    expect(await recipients(elsewhere.id, 'AttendanceChangeRequested')).toEqual([f.owner]);
  } finally {
    await clearRules();
  }
});

it('62-2b: the defaults keep the recipients of today — personal ALLOW, custom role, DENY, requester and employee', async () => {
  const allowed = await personalAllow('alert-allowed@example.test');
  const custom = await customRoleHolder('alert-custom@example.test');
  const denied = await customRoleHolder('alert-denied@example.test', true);
  const plain = await file();
  expect(await recipients(plain.id, 'AttendanceChangeRequested')).toEqual(
    [allowed, custom, f.owner].sort(),
  );
  expect(await recipients(plain.id, 'AttendanceChangeRequested')).not.toContain(denied);
  const byHolder = await file(f.employee.id, allowed);
  expect(await recipients(byHolder.id, 'AttendanceChangeRequested')).toEqual([custom, f.owner].sort());
  const aboutHolder = await file(await linkEmployee(f, allowed));
  expect(await recipients(aboutHolder.id, 'AttendanceChangeRequested')).toEqual(
    [custom, f.owner].sort(),
  );
  const aboutOwner = await file(await linkEmployee(f, f.owner));
  expect(await recipients(aboutOwner.id, 'AttendanceChangeRequested')).toEqual(
    [allowed, custom, f.owner].sort(),
  );
});

it('62-2b: the rule is read on the caller transaction', async () => {
  const rule = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(
      sql`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,delay_minutes,lead_minutes,updated_by,revision)
        VALUES (${f.company},${leaveIds.newId()},${f.business},NULL,'ATTENDANCE_CHANGE_REQUESTED',false,ARRAY[]::text[],ARRAY['IN_APP']::text[],NULL,NULL,${f.owner},1)`,
    );
    return attendanceChangeAlertRule(
      tx,
      f.company,
      { businessId: f.business, branchId: f.branch },
      'ATTENDANCE_CHANGE_REQUESTED',
    );
  });
  expect(rule.enabled).toBe(false);
  await clearRules();
});
