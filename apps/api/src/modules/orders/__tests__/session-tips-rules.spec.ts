import { afterAll, beforeAll, expect, it } from 'vitest';
import { ordersSessionTips } from '../orders.module.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import {
  AT,
  cancelLine,
  caught,
  errorShape,
  ids,
  must,
  pairLine,
  payloadOf,
  recordVisit,
  recordVisitAt,
  refusedTips,
  runTips,
  tip,
  tipFixture,
  tipInput,
  tipQuiet,
  tipRows,
  twoLines,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
beforeAll(async () => {
  f = await tipFixture();
});
afterAll(async () => {
  await f?.close();
});

it('TP-04 a snapshot of the cashier refuses a self tip', async () => {
  const employeeId = must(f.employees[0]);
  const visit = await recordVisit(f);
  await f.snapshotPerformers(must(visit.lineIds[0]), [
    { employee_id: employeeId, linked_user_id: f.userId, linked_user_snapshotted: true },
  ]);
  expect(
    (await refusedTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]))).code,
  ).toBe('TIP_SELF_FORBIDDEN');
  const saved = await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), {
    userId: f.ownerId,
  });
  expect(saved.revision).toBe(1);
});

it('TP-04 a current link of the cashier refuses a self tip', async () => {
  const employeeId = must(f.employees[0]);
  const visit = await recordVisit(f);
  await f.linkEmployee(employeeId, f.userId);
  try {
    expect(
      (await refusedTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]))).code,
    ).toBe('TIP_SELF_FORBIDDEN');
    const saved = await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), {
      userId: f.ownerId,
    });
    expect(saved.revision).toBe(1);
  } finally {
    await f.linkEmployee(employeeId, null);
  }
});

it('TP-04 an unsnapshotted row is unknown to the manager and the linked actor, and another employee stays editable', async () => {
  const employeeId = must(f.employees[0]);
  const visit = await recordVisit(f, [pairLine(f)]);
  await f.snapshotPerformers(must(visit.lineIds[0]), [
    { employee_id: employeeId, linked_user_id: null, linked_user_snapshotted: false },
  ]);
  await f.linkEmployee(employeeId, f.userId);
  try {
    const touching = tipInput([tip(f, 0, 'CASH', '1.000')]);
    expect((await refusedTips(f, visit.sessionId, touching)).code).toBe('TIP_IDENTITY_UNKNOWN');
    expect((await refusedTips(f, visit.sessionId, touching, { userId: f.ownerId })).code).toBe(
      'TIP_IDENTITY_UNKNOWN',
    );
    const saved = await runTips(f, visit.sessionId, tipInput([tip(f, 1, 'CARD', '1.500')]));
    const replaced = await runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 1, 'CARD', '2.500')], { expected_revision: 1, reason: 'other employee' }),
    );
    expect(saved.revision).toBe(1);
    expect(replaced.revision).toBe(2);
  } finally {
    await f.linkEmployee(employeeId, null);
  }
});

it('TP-05 a cancelled line keeps a carried tip, allows its removal, and refuses adding it back', async () => {
  const visit = await recordVisit(f, twoLines(f));
  const kept = tip(f, 0, 'CASH', '1.000');
  const other = tip(f, 1, 'CARD', '2.000');
  await runTips(f, visit.sessionId, tipInput([kept, other]));
  await cancelLine(f, must(visit.lineIds[0]));
  const carried = await runTips(
    f,
    visit.sessionId,
    tipInput([kept, tip(f, 1, 'CARD', '3.000')], {
      expected_revision: 1,
      reason: 'replace the other',
    }),
  );
  expect(carried.tips).toHaveLength(2);
  const removed = await runTips(
    f,
    visit.sessionId,
    tipInput([tip(f, 1, 'CARD', '3.000')], {
      expected_revision: 2,
      reason: 'drop the carried tip',
    }),
  );
  expect(removed.tips.map((entry) => entry.employee_id)).toEqual([must(f.employees[1])]);
  expect(
    (
      await refusedTips(
        f,
        visit.sessionId,
        tipInput([tip(f, 1, 'CARD', '3.000'), kept], {
          expected_revision: 3,
          reason: 'add the cancelled performer',
        }),
      )
    ).code,
  ).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
});

it('TP-06 a closed window is refused and the oldest open day still accepts a tip', async () => {
  f.setAt(new Date('2026-08-15T08:00:00.000Z'));
  try {
    const closed = await recordVisitAt(f, '2026-08-15T08:00:00.000Z');
    f.setAt(AT);
    expect(
      (await refusedTips(f, closed.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]))).code,
    ).toBe('TIP_WINDOW_CLOSED');
  } finally {
    f.setAt(AT);
  }
  const open = await recordVisitAt(f, '2026-09-01T08:00:00.000Z');
  expect((await runTips(f, open.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]))).revision).toBe(
    1,
  );
});

it('TP-07 a stale expected revision conflicts with only current_revision and writes nothing', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  expect(
    await refusedTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '2.000')], { expected_revision: 0, reason: 'late' }),
    ),
  ).toEqual({
    code: 'TIP_REVISION_CONFLICT',
    message: 'TIP_REVISION_CONFLICT',
    details: { current_revision: 1 },
  });
});

it('TP-08 a replacement needs a stored reason and that reason stays off the audit, event and response', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  expect(must((await tipRows(f, visit.sessionId)).revisions[0])['reason']).toBeNull();
  const next = [tip(f, 0, 'CASH', '2.000')];
  expect(
    (await refusedTips(f, visit.sessionId, tipInput(next, { expected_revision: 1 }))).code,
  ).toBe('TIP_REASON_REQUIRED');
  expect(
    (
      await refusedTips(f, visit.sessionId, tipInput(next, { expected_revision: 1, reason: ' \t' }))
    ).code,
  ).toBe('TIP_REASON_REQUIRED');
  expect(
    (
      await refusedTips(
        f,
        visit.sessionId,
        tipInput(next, { expected_revision: 1, reason: 'a'.repeat(501) }),
      )
    ).code,
  ).toBe('VALIDATION_FAILED');
  const fresh = await recordVisit(f);
  const reason = '  kept reason  ';
  const stored = await runTips(
    f,
    fresh.sessionId,
    tipInput([tip(f, 0, 'CARD', '1.250')], { reason }),
  );
  const rows = await tipRows(f, fresh.sessionId);
  const blob = JSON.stringify({
    stored,
    audits: rows.audits,
    events: rows.events.map((event) => payloadOf(event['payload'])),
  });
  expect(must(rows.revisions[0])['reason']).toBe('kept reason');
  expect(blob).not.toContain('kept reason');
  expect((await tipRows(f, visit.sessionId)).revisions).toHaveLength(1);
});

it('D-T1 an identical set changes nothing, and a stale identical request conflicts', async () => {
  const empty = await recordVisit(f);
  const emptyKey = ids.newId();
  expect(
    errorShape(await caught(runTips(f, empty.sessionId, tipInput([]), { key: emptyKey }))).code,
  ).toBe('TIP_NO_CHANGE');
  expect(await tipQuiet(f, empty.sessionId, emptyKey)).toEqual({
    revisions: 0,
    entries: 0,
    audits: 0,
    events: 0,
    keys: 0,
  });
  const visit = await recordVisit(f);
  const same = [tip(f, 0, 'CASH', '1.000')];
  await runTips(f, visit.sessionId, tipInput(same));
  const sameKey = ids.newId();
  expect(
    errorShape(
      await caught(
        runTips(f, visit.sessionId, tipInput(same, { expected_revision: 1, reason: 'same set' }), {
          key: sameKey,
        }),
      ),
    ).code,
  ).toBe('TIP_NO_CHANGE');
  expect((await tipQuiet(f, visit.sessionId, sameKey)).revisions).toBe(1);
  const stale = errorShape(
    await caught(
      runTips(f, visit.sessionId, tipInput(same, { expected_revision: 0, reason: 'same set' })),
    ),
  );
  expect(stale.code).toBe('TIP_REVISION_CONFLICT');
});

it('a missing current link is unknown before a closed window', async () => {
  f.setAt(new Date('2026-08-15T08:00:00.000Z'));
  try {
    const visit = await recordVisitAt(f, '2026-08-15T08:00:00.000Z');
    f.setAt(AT);
    const base = ordersSessionTips(f.db);
    const tips = new RecordSessionTipsUseCase(
      {
        run: (context, work) =>
          base.run(context, (tx) =>
            work({
              ...tx,
              performers: { lock: (batch) => tx.performers.lock(batch), read: async () => [] },
            }),
          ),
      },
      ids,
      f.clock,
    );
    const key = ids.newId();
    const before = await tipQuiet(f, visit.sessionId, key);
    const error = errorShape(
      await caught(
        tips.execute({
          ...f.context(key),
          sessionId: visit.sessionId,
          input: tipInput([tip(f, 0, 'CASH', '1.000')]),
        }),
      ),
    );
    expect(error.code).toBe('TIP_IDENTITY_UNKNOWN');
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual(before);
  } finally {
    f.setAt(AT);
  }
});

it('a closed window is refused before a missing replacement reason', async () => {
  f.setAt(new Date('2026-08-15T08:00:00.000Z'));
  try {
    const visit = await recordVisitAt(f, '2026-08-15T08:00:00.000Z');
    await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
    f.setAt(AT);
    expect(
      (
        await refusedTips(
          f,
          visit.sessionId,
          tipInput([tip(f, 0, 'CASH', '2.000')], { expected_revision: 1 }),
        )
      ).code,
    ).toBe('TIP_WINDOW_CLOSED');
  } finally {
    f.setAt(AT);
  }
});

it('a missing replacement reason is refused before a self tip', async () => {
  const employeeId = must(f.employees[0]);
  const visit = await recordVisit(f);
  await f.linkEmployee(employeeId, f.userId);
  try {
    await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), {
      userId: f.ownerId,
    });
    expect(
      (
        await refusedTips(
          f,
          visit.sessionId,
          tipInput([tip(f, 0, 'CASH', '2.000')], { expected_revision: 1 }),
        )
      ).code,
    ).toBe('TIP_REASON_REQUIRED');
  } finally {
    await f.linkEmployee(employeeId, null);
  }
});
