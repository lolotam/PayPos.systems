import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must } from './session.fixture.ts';
import {
  changeQuiet,
  changeRows,
  createEmployee,
  livePerformers,
  nineColumns,
  performersFixture,
  performersInput,
  runChange,
  seedWarnings,
  visitAt,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('PC-05 an added performer is checked at the recording time, not today', async () => {
  const visit = await visitAt(f, '2026-10-01T08:00:00.000Z');
  const line = must(visit.lines[0]).id;
  const leaving = await createEmployee(f, { contract_end: '2026-10-05' });
  const result = await runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: leaving, share_bps: 5000 }, { employee_id: must(f.employees[0]), share_bps: 5000 }],
  }));
  expect(result).toMatchObject({ line: { revision: 2 } });
  const saved = await changeRows(f, visit.sessionId, line);
  expect(saved.live.map((row) => row['employee_id'])).toEqual([leaving, must(f.employees[0])]);
});

it('PC-05 a performer attached to the branch only later is refused with her id', async () => {
  const visit = await visitAt(f, '2026-10-01T08:00:00.000Z');
  const line = must(visit.lines[0]).id;
  const late = await createEmployee(f, { branch_from: '2026-10-05' });
  const key = ids.newId();
  const error = await runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: late, share_bps: 5000 }, { employee_id: must(f.employees[0]), share_bps: 5000 }],
  }), { key }).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'SESSION_PERFORMER_NOT_ELIGIBLE', details: { employee_ids: [late] } });
  expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  expect((await livePerformers(f, line)).map((row) => row['employee_id'])).toEqual([must(f.employees[0])]);
});

it('PC-05 a kept performer who left the business keeps her row and the change is accepted', async () => {
  const visit = await visitOf(f, [trioLine(f)]);
  const line = must(visit.lines[0]).id;
  const kept = must(f.employees[0]);
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${kept}`;
  try {
    const result = await runChange(f, visit.sessionId, line, performersInput({
      performers: [
        { employee_id: kept, share_bps: 5000 },
        { employee_id: must(f.employees[1]), share_bps: 4000 },
        { employee_id: must(f.employees[2]), share_bps: 1000 },
      ],
    }));
    expect(result).toMatchObject({ line: { revision: 2 } });
    const saved = await changeRows(f, visit.sessionId, line);
    const before = saved.sides.filter((row) => row['side'] === 'BEFORE').map((row) => nineColumns(row));
    const after = saved.sides.filter((row) => row['side'] === 'AFTER').map((row) => nineColumns(row));
    expect(after[0]).toEqual(before[0]);
  } finally {
    await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${kept}`;
  }
});

it('PC-06 the line flag follows the warnings of the added performer and clears when she leaves', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await seedWarnings(f, line, [{ employee_id: must(f.employees[0]), not_clocked_in_warning: false, approved_leave_warning: false }]);
  await runChange(f, visit.sessionId, line, performersInput({
    performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: must(f.employees[1]), share_bps: 5000 }],
  }));
  const raised = await changeRows(f, visit.sessionId, line);
  expect(raised.line).toMatchObject({ has_performer_warning: true });
  expect(raised.live.find((row) => row['employee_id'] === must(f.employees[1]))).toMatchObject({
    not_clocked_in_warning: true, approved_leave_warning: false,
  });
  await runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[0]) }] }));
  const cleared = await changeRows(f, visit.sessionId, line);
  expect(cleared.line).toMatchObject({ has_performer_warning: false });
});

it('PC-13 an added performer carries her link and a kept one keeps her recording-time link', async () => {
  const first = await newUser('performers-linked-a@example.test');
  const second = await newUser('performers-linked-b@example.test');
  const linked = await createEmployee(f, { user_id: first });
  const unlinked = await createEmployee(f);
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await f.h.owner`UPDATE employees SET user_id=${second} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  const result = await runChange(f, visit.sessionId, line, performersInput({
    performers: [
      { employee_id: must(f.employees[0]), share_bps: 5000 },
      { employee_id: linked, share_bps: 3000 },
      { employee_id: unlinked, share_bps: 2000 },
    ],
  }));
  expect(result).toMatchObject({ line: { revision: 2 } });
  const saved = await changeRows(f, visit.sessionId, line);
  const rows = saved.live.map((row) => nineColumns(row));
  expect(rows[0]).toMatchObject({ employee_id: must(f.employees[0]), linked_user_id: null, linked_user_snapshotted: true });
  expect(rows[1]).toMatchObject({ employee_id: linked, linked_user_id: first, linked_user_snapshotted: true });
  expect(rows[2]).toMatchObject({ employee_id: unlinked, linked_user_id: null, linked_user_snapshotted: true });
});

async function newUser(email: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  return must(users[0])['id'] as string;
}

function trioLine(fixture: PerformersFixture) {
  return {
    ...fixture.line(must(fixture.services[0]), '25.000', '0.000'),
    performers: [
      { employee_id: must(fixture.employees[0]), share_bps: 5000 },
      { employee_id: must(fixture.employees[1]), share_bps: 3000 },
      { employee_id: must(fixture.employees[2]), share_bps: 2000 },
    ],
  };
}
