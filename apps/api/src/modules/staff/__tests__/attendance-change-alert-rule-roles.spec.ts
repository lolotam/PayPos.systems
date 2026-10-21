import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import type { AlertRecipientRole } from '@pospay/domain';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeEvents,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  // صاحبة الطلب نفسها حاملة لدور النظام، فاستبعادها من الإشعار معناه استبعاد حقيقي.
  await asRole(f, 'general_manager');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const file = (employeeId = f.employee.id) =>
  f.fileChange.execute(changeActor(f), { ...changeInput(f), employee_id: employeeId });
const approve = (id: string) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision: 0 });
const recipients = async (id: string, eventType: string) =>
  (await changeEvents(f, id))
    .filter((event) => event['event_type'] === eventType)
    .flatMap((event) =>
      (event['payload'].notification_recipients ?? []).map((r: { user_id: string }) => r.user_id),
    );
const newUser = async (email: string) => {
  await f.h.signedInOperator(email);
  const [row] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  return row?.['id'] as string;
};
const created: string[] = [];
const membership = async (
  userId: string,
  roleCode: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
  endsAt: string | null = null,
) => {
  const id = leaveIds.newId();
  const role = SYSTEM_ROLES.find((entry) => entry.code === roleCode)?.id as string;
  await f.h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES (${f.company},${id},${userId},${role},'global',${scopeType},${scopeId},'2026-01-01',${endsAt})`;
  created.push(id);
  return id;
};
const override = async (membershipId: string, permission: string) => {
  await f.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${leaveIds.newId()},${membershipId},${permission},'ALLOW','COMPANY',${f.company},'Synthetic delegation',${f.owner})`;
};
const saveRule = async (kind: string, roles: readonly AlertRecipientRole[]) => {
  const list = [...roles];
  await f.h.owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,delay_minutes,lead_minutes,updated_by,revision)
    VALUES (${f.company},${leaveIds.newId()},${f.business},NULL,${kind},true,${list},ARRAY['IN_APP']::text[],NULL,NULL,${f.owner},1)`;
};
const clearRules = () =>
  f.h.owner`DELETE FROM alert_rules WHERE company_id=${f.company} AND business_id=${f.business}`;
// العضويات المضافة في كل حالة بتتشال بعدها، عشان كل حالة تشوف حامليها هي بس.
const clearMemberships = async () => {
  if (created.length === 0) return;
  await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id = ANY(${created}::uuid[])`;
  created.length = 0;
};

it('62-2b: the rule roles add recipients beside the permission holders, each one once', async () => {
  const holder = await newUser('alert-role-holder@example.test');
  const both = await newUser('alert-role-decider@example.test');
  const elsewhere = await newUser('alert-role-elsewhere@example.test');
  const ended = await newUser('alert-role-ended@example.test');
  await membership(holder, 'branch_manager', 'BRANCH', f.branch);
  const bothMember = await membership(both, 'branch_manager', 'BRANCH', f.branch);
  await membership(elsewhere, 'branch_manager', 'BRANCH', f.secondBranch);
  await membership(ended, 'branch_manager', 'BRANCH', f.branch, '2026-10-01');
  await override(bothMember, 'decide:attendance-change:company');
  await saveRule('ATTENDANCE_CHANGE_REQUESTED', ['branch_manager']);
  try {
    const request = await file();
    const notified = await recipients(request.id, 'AttendanceChangeRequested');
    expect(notified).toEqual([both, f.owner, holder].sort());
    expect(notified).not.toContain(elsewhere);
    expect(notified).not.toContain(ended);
  } finally {
    await clearRules();
    await clearMemberships();
  }
});

it('62-2b: the decided kind adds the role holders beside the requester and leaves the decider out', async () => {
  const holder = await newUser('alert-decided-role@example.test');
  await membership(holder, 'branch_manager', 'BRANCH', f.branch);
  await saveRule('ATTENDANCE_CHANGE_DECIDED', ['branch_manager']);
  try {
    const request = await file();
    await approve(request.id);
    const notified = await recipients(request.id, 'AttendanceChangeDecided');
    expect(notified).toEqual([f.approverId, holder].sort());
    expect(notified).not.toContain(f.owner);
  } finally {
    await clearRules();
    await clearMemberships();
  }
});

it('62-2b: a company-scope role covers the branch and the requester never gets her own bell', async () => {
  const holder = await newUser('alert-company-role@example.test');
  await membership(holder, 'general_manager', 'COMPANY', f.company);
  await saveRule('ATTENDANCE_CHANGE_REQUESTED', ['general_manager']);
  try {
    const request = await file();
    const notified = await recipients(request.id, 'AttendanceChangeRequested');
    expect(notified).toEqual([f.owner, holder].sort());
    expect(notified).not.toContain(f.approverId);
  } finally {
    await clearRules();
    await clearMemberships();
  }
});
