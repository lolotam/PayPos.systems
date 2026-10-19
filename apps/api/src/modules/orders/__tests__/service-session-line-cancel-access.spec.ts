import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyChange, performer, type Person } from '../../../../../../packages/db/test/service-line-performer-change.ts';
import { recordVisit, runTips, tip, tipInput, tipRows } from '../../../../test/session-tips.fixture.ts';
import { ids, must } from './session.fixture.ts';
import {
  cancelFixture,
  cancelInput,
  cancelQuiet,
  performersOf,
  runCancel,
  visitOf,
  type CancelFixture,
} from './line-cancel.helpers.ts';

let f: CancelFixture;
beforeAll(async () => { f = await cancelFixture(); });
afterAll(async () => { await f?.close(); });

it('FR-011 a disabled feature refuses an unknown line before scope', async () => {
  const visit = await visitOf(f);
  const key = ids.newId();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature',${f.ownerId})`;
  try {
    await expect(runCancel(f, visit.sessionId, ids.newId(), cancelInput(), { key })).rejects.toThrow('FEATURE_DISABLED');
    expect(await cancelQuiet(f, visit.sessionId, must(visit.lines[0]).id, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

it('FR-011 a caller without permission is refused before the line lock', async () => {
  const visit = await visitOf(f);
  const lineId = must(visit.lines[0]).id;
  const held = await holdLine(f, lineId);
  const key = ids.newId();
  const started = Date.now();
  const pending = runCancel(f, visit.sessionId, lineId, cancelInput(), { userId: f.userId, key }).then(
    () => 'committed',
    (error: unknown) => error,
  );
  try {
    const outcome = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 1500)),
    ]);
    expect(Date.now() - started).toBeLessThan(1400);
    expect(outcome).toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await held.release();
    await pending;
  }
  expect(await cancelQuiet(f, visit.sessionId, lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-006 a retained BEFORE performer who is the caller cannot cancel that line', async () => {
  const base = f.line(must(f.services[0]), '25.000', '0.000');
  const visit = await visitOf(f, [{ ...base, performers: [{ employee_id: f.editorEmployee }] }]);
  const lineId = must(visit.lines[0]).id;
  await replacePerformer(f, visit.sessionId, lineId, must(f.employees[0]));
  const [retained] = await f.h.owner`SELECT r.employee_id, r.linked_user_id, r.linked_user_snapshotted, r.side
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c ON c.company_id=r.company_id AND c.id=r.change_id
    WHERE r.company_id=${f.company} AND c.line_id=${lineId} AND r.side='BEFORE'`;
  expect(retained).toMatchObject({ employee_id: f.editorEmployee, linked_user_id: f.editorId, linked_user_snapshotted: true, side: 'BEFORE' });
  const key = ids.newId();
  await expect(runCancel(f, visit.sessionId, lineId, cancelInput({ expected_revision: 2 }), { key })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  expect(await cancelQuiet(f, visit.sessionId, lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-009 spec 054 §3.2: active performers exclude a retained one, so their tip does not block cancel', async () => {
  const kept = must(f.employees[0]);
  const visit = await recordVisit(f);
  const lineId = must(visit.lineIds[0]);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  await replacePerformer(f, visit.sessionId, lineId, must(f.employees[1]));
  const saved = await runCancel(f, visit.sessionId, lineId, cancelInput({ expected_revision: 2 }));
  expect(saved).toMatchObject({ line: { status: 'CANCELLED', revision: 3 } });
  const tips = await tipRows(f, visit.sessionId);
  expect(tips.entries).toEqual([expect.objectContaining({ employee_id: kept, method: 'CASH', amount: '1.000' })]);
});

async function holdLine(fixture: CancelFixture, lineId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  const holder = fixture.h.owner.begin(async (tx) => {
    await tx`SELECT id FROM service_lines WHERE company_id=${fixture.company} AND id=${lineId} FOR UPDATE`;
    locked();
    await released;
  });
  await acquired;
  let done = false;
  return {
    release: async () => {
      if (done) return;
      done = true;
      release();
      await holder;
    },
  };
}

async function replacePerformer(fixture: CancelFixture, sessionId: string, lineId: string, replacementId: string) {
  const [line] = await fixture.h.owner`SELECT service_id, revision, has_performer_warning FROM service_lines WHERE company_id=${fixture.company} AND id=${lineId}`;
  const current = must(line);
  expect(Number(current['revision'])).toBe(1);
  const before = await livePerson(fixture, lineId);
  const next = await employeePerson(fixture, replacementId);
  await fixture.db.withTenant(fixture.company, (tx) => applyChange(tx, {
    company: fixture.company,
    business: fixture.business,
    branch: fixture.branch,
    userId: fixture.ownerId,
    membershipId: fixture.ownerMembership,
    sessionId,
    serviceId: String(current['service_id']),
  }, ids, {
    lineId,
    previous: 1,
    revision: 2,
    before: [before],
    live: [next],
    after: [next],
    warning: next.clock || next.leave,
  }), { userId: fixture.ownerId });
  expect((await performersOf(fixture, lineId)).map((row) => row['employee_id'])).toEqual([replacementId]);
  const [moved] = await fixture.h.owner`SELECT revision FROM service_lines WHERE company_id=${fixture.company} AND id=${lineId}`;
  expect(Number(moved?.['revision'])).toBe(2);
}

async function livePerson(fixture: CancelFixture, lineId: string): Promise<Person> {
  const [row] = await fixture.h.owner`SELECT employee_id, performer_ordinal, share_bps, linked_user_id, linked_user_snapshotted,
    name_en, name_ar, not_clocked_in_warning, approved_leave_warning
    FROM line_performers WHERE company_id=${fixture.company} AND line_id=${lineId}`;
  const live = must(row);
  return performer(String(live['employee_id']), {
    ordinal: Number(live['performer_ordinal']),
    share: Number(live['share_bps']),
    userId: textOrNull(live['linked_user_id']),
    nameEn: String(live['name_en']),
    nameAr: textOrNull(live['name_ar']),
    snapshotted: live['linked_user_snapshotted'] === true,
    clock: live['not_clocked_in_warning'] === true,
    leave: live['approved_leave_warning'] === true,
  });
}

async function employeePerson(fixture: CancelFixture, employeeId: string): Promise<Person> {
  const [row] = await fixture.h.owner`SELECT name_en, name_ar, user_id FROM employees WHERE company_id=${fixture.company} AND id=${employeeId}`;
  const employee = must(row);
  return performer(employeeId, {
    userId: textOrNull(employee['user_id']),
    nameEn: String(employee['name_en']),
    nameAr: textOrNull(employee['name_ar']),
    snapshotted: true,
  });
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
