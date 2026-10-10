import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequestPage } from '@pospay/contracts';
import { asRole } from './attendance-exception.fixture.ts';
import { linkEmployee, seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  changeEvents,
  effectCount,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { AttendanceChangeKindRefusal } from '../ports/attendance-change-kinds.port.ts';
import { createAttendanceChangeReadAccess } from '../persistence/attendance-change-context.adapter.ts';
import { listAttendanceChangeRequests } from '../queries/attendance-change-requests.query.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const list = (branchId?: string) =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/attendance-change-requests${branchId ? `?branch_id=${branchId}` : ''}`,
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
  });

it('an active requester can list and withdraw her filings after both permissions are revoked', async () => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const outside = await f.fileChange.execute(changeActor(f), {
    ...changeInput(f),
    kind: 'VOID_SESSION',
    session_id,
  });
  const other = await f.fileChange.execute(changeActor(f, undefined, f.owner), changeInput(f));
  await asRole(f, 'accountant');
  try {
    const response = await list();
    expect(response.statusCode).toBe(200);
    const page = attendanceChangeRequestPage.parse(response.json());
    expect(page.items.map((r) => r.id).sort()).toEqual([row.id, outside.id].sort());
    expect(page.items.every((r) => r.can_cancel && !r.can_decide)).toBe(true);
    expect(page.items.some((r) => r.id === other.id)).toBe(false);
    const filtered = await list(f.secondBranch);
    expect(filtered.statusCode).toBe(200);
    expect(attendanceChangeRequestPage.parse(filtered.json()).items.map((r) => r.id)).toEqual([
      outside.id,
    ]);
    expect(await f.cancelChange.execute(changeActor(f, row.id), { revision: 0 })).toMatchObject({
      status: 'CANCELLED',
    });
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-01' WHERE id=${f.approverMember}`;
    expect((await list()).statusCode).toBe(403);
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.approverMember}`;
    await asRole(f, 'business_manager');
  }
});

it('non-owner requesters and delegated deciders cannot list requests about their own attendance', async () => {
  const employee_id = await linkEmployee(f, f.approverId);
  const ownAttendance = await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...changeInput(f),
    employee_id,
  });
  const unrelated = await f.fileChange.execute(changeActor(f), changeInput(f));
  const grantId = leaveIds.newId();
  try {
    for (const delegated of [false, true]) {
      if (delegated)
        await f.h.owner`INSERT INTO permission_overrides
        (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
        VALUES(${f.company},${grantId},${f.approverMember},'decide:attendance-change:company',
          'ALLOW','BUSINESS',${f.business},'Synthetic delegated decision',${f.owner})`;
      const response = await list();
      expect(response.statusCode).toBe(200);
      const ids = attendanceChangeRequestPage.parse(response.json()).items.map((r) => r.id);
      expect(ids).not.toContain(ownAttendance.id);
      expect(ids).toContain(unrelated.id);
    }
    const ownerRows = await f.h
      .owner`SELECT id FROM attendance_change_requests WHERE employee_id=${employee_id}`;
    expect(ownerRows.map((r) => r.id)).toContain(ownAttendance.id);
    const ownerPage = await f.db.withTenant(f.company, (tx) =>
      listAttendanceChangeRequests(
        tx,
        { companyId: f.company, businessId: f.business, userId: f.owner },
        { limit: 50 },
        createAttendanceChangeReadAccess(f.clock),
      ),
    );
    expect(attendanceChangeRequestPage.parse(ownerPage).items.map((r) => r.id)).toContain(
      ownAttendance.id,
    );
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${grantId}`;
  }
});

it('approval preserves a VOID target when the kind returns null, including the owner one-step path', async () => {
  const session_id = await seedSession(f, { employeeId: f.employee.id });
  const input = {
    ...changeInput(f),
    kind: 'VOID_SESSION' as const,
    session_id,
    session_revision: 0,
  };
  const row = await f.fileChange.execute(changeActor(f), input);
  f.control.nullSession = true;
  try {
    const approved = await f.decideChange.execute(changeActor(f, row.id, f.owner), {
      decision: 'APPROVED',
      revision: 0,
    });
    expect(approved).toMatchObject({ status: 'APPROVED', session_id, session_revision: 0 });
    expect(
      await f.h.owner`SELECT session_id FROM attendance_change_requests WHERE id=${row.id}`,
    ).toEqual([{ session_id }]);
    const immediate = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
    expect(immediate).toMatchObject({ status: 'APPROVED', session_id });
    expect(
      await f.h.owner`SELECT session_id FROM attendance_change_requests WHERE id=${immediate.id}`,
    ).toEqual([{ session_id }]);
  } finally {
    f.control.nullSession = false;
  }
});

it('a refusal after applying rolls back the effect and preserves the refusal object', async () => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  const effects = await effectCount(f);
  f.control.kindRefusalAfterEffect = true;
  try {
    await expect(
      f.decideChange.execute(changeActor(f, row.id, f.owner), {
        decision: 'APPROVED',
        revision: 0,
      }),
    ).rejects.toBeInstanceOf(AttendanceChangeKindRefusal);
    expect(
      await f.h.owner`SELECT status,revision FROM attendance_change_requests WHERE id=${row.id}`,
    ).toEqual([{ status: 'PENDING', revision: 0 }]);
    expect(await effectCount(f)).toEqual(effects);
    expect(await changeAudits(f, row.id)).toHaveLength(1);
    expect(await changeEvents(f, row.id)).toHaveLength(1);
  } finally {
    f.control.kindRefusalAfterEffect = false;
  }
});

it.each(['APPROVED', 'REJECTED'] as const)(
  'emits %s without recipients after the requester leaves the business',
  async (decision) => {
    const row = await f.fileChange.execute(changeActor(f), changeInput(f));
    await f.h
      .owner`UPDATE memberships SET scope_id=${f.secondBusiness} WHERE id=${f.approverMember}`;
    try {
      await f.decideChange.execute(changeActor(f, row.id, f.owner), {
        decision,
        revision: 0,
        reason: 'Synthetic decision',
      });
      const events = await changeEvents(f, row.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        event_type: 'AttendanceChangeDecided',
        payload: { status: decision },
      });
      expect(events[1]?.payload).not.toHaveProperty('notification_recipients');
    } finally {
      await asRole(f, 'business_manager');
    }
  },
);

it('emits a decision without recipients after the requester membership expires', async () => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-01' WHERE id=${f.approverMember}`;
  try {
    await f.decideChange.execute(changeActor(f, row.id, f.owner), {
      decision: 'REJECTED',
      revision: 0,
      reason: 'Synthetic decision',
    });
    const event = (await changeEvents(f, row.id)).at(-1);
    expect(event).toMatchObject({ event_type: 'AttendanceChangeDecided' });
    expect(event?.payload).not.toHaveProperty('notification_recipients');
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.approverMember}`;
  }
});
