import type { RecordSessionTipsInput } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ordersSessionTips } from '../orders.module.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import {
  AT,
  caught,
  errorShape,
  holdEmployeeUpdate,
  holdVisit,
  ids,
  must,
  recordVisit,
  runTips,
  separateOwner,
  tip,
  tipFixture,
  tipInput,
  tipQuiet,
  tipRows,
  waitForAdvisory,
  waitForBlocked,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

const NOT_FOUND = {
  code: 'SESSION_NOT_FOUND',
  message: 'SESSION_NOT_FOUND',
  details: undefined,
};
const QUIET = { revisions: 0, entries: 0, audits: 0, events: 0, keys: 0 };
const HELD = { revisions: 1, entries: 2, audits: 1, events: 1, keys: 0 };

let f: TipFixture;
beforeAll(async () => {
  f = await tipFixture();
});
afterAll(async () => {
  await f?.close();
});

function trio(fixture: TipFixture) {
  const line = fixture.line(must(fixture.services[0]), '25.000', '0.000');
  return {
    ...line,
    performers: [0, 1, 2].map((index) => ({ employee_id: must(fixture.employees[index]) })),
  };
}

async function persistedSet(fixture: TipFixture) {
  const visit = await recordVisit(fixture, [trio(fixture)]);
  const lineId = must(visit.lineIds[0]);
  const selfId = must(fixture.employees[0]);
  await fixture.snapshotPerformers(lineId, [
    { employee_id: selfId, linked_user_id: fixture.userId, linked_user_snapshotted: true },
  ]);
  await fixture.linkEmployee(selfId, fixture.userId);
  const kept = [tip(fixture, 0, 'CASH', '1.000'), tip(fixture, 1, 'CARD', '1.000')];
  await runTips(fixture, visit.sessionId, tipInput(kept), { userId: fixture.ownerId });
  await fixture.snapshotPerformers(lineId, [
    {
      employee_id: must(fixture.employees[1]),
      linked_user_id: null,
      linked_user_snapshotted: false,
    },
  ]);
  return { sessionId: visit.sessionId, kept };
}

async function refusalCode(
  fixture: TipFixture,
  sessionId: string,
  input: RecordSessionTipsInput,
  userId?: string,
) {
  const key = ids.newId();
  const error = errorShape(await caught(runTips(fixture, sessionId, input, { key, userId })));
  expect(await tipQuiet(fixture, sessionId, key)).toEqual(HELD);
  return error.code;
}

it('TP-04 a persisted self entry and an unsnapshotted entry refuse a touch and allow carrying both', async () => {
  const { sessionId, kept } = await persistedSet(f);
  const [self, unknown] = kept;
  const reason = { expected_revision: 1, reason: 'touch' };
  const changedSelf = tip(f, 0, 'CASH', '2.000');
  const changedUnknown = tip(f, 1, 'CARD', '2.000');
  try {
    expect(await refusalCode(f, sessionId, tipInput([changedSelf, unknown], reason))).toBe(
      'TIP_SELF_FORBIDDEN',
    );
    expect(await refusalCode(f, sessionId, tipInput([unknown], reason))).toBe('TIP_SELF_FORBIDDEN');
    expect(await refusalCode(f, sessionId, tipInput([self, changedUnknown], reason))).toBe(
      'TIP_IDENTITY_UNKNOWN',
    );
    expect(await refusalCode(f, sessionId, tipInput([self], reason))).toBe('TIP_IDENTITY_UNKNOWN');
    expect(
      await refusalCode(f, sessionId, tipInput([self, changedUnknown], reason), f.ownerId),
    ).toBe('TIP_IDENTITY_UNKNOWN');
    expect(await refusalCode(f, sessionId, tipInput([self], reason), f.ownerId)).toBe(
      'TIP_IDENTITY_UNKNOWN',
    );
    const saved = await runTips(
      f,
      sessionId,
      tipInput([self, unknown, tip(f, 2, 'CASH', '1.500')], {
        expected_revision: 1,
        reason: 'add another',
      }),
    );
    expect(saved.revision).toBe(2);
    expect(saved.tips).toHaveLength(3);
  } finally {
    await f.linkEmployee(must(f.employees[0]), null);
  }
});

it('the self rule reads the employee link after the employee row lock', async () => {
  const employeeId = must(f.employees[0]);
  const visit = await recordVisit(f);
  const held = await holdEmployeeUpdate(f, employeeId, f.userId);
  const key = ids.newId();
  const pending = runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key });
  try {
    const waiting = await waitForBlocked(f, held.pid, 1);
    expect(waiting.map((row) => String(row['query'])).join('\n')).toMatch(
      /employees[\s\S]*FOR SHARE/i,
    );
    await held.commit();
    expect(errorShape(await caught(pending))).toEqual({
      code: 'TIP_SELF_FORBIDDEN',
      message: 'TIP_SELF_FORBIDDEN',
      details: undefined,
    });
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual(QUIET);
  } finally {
    await held.commit();
    await pending.catch(() => undefined);
    await f.linkEmployee(employeeId, null);
  }
});

it('a stale request conflicts before a missing staff row is an unknown identity', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
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
  const error = await caught(
    tips.execute({
      ...f.context(key),
      sessionId: visit.sessionId,
      input: tipInput([tip(f, 0, 'CASH', '2.000')], { expected_revision: 0, reason: 'stale' }),
    }),
  );
  expect(errorShape(error)).toEqual({
    code: 'TIP_REVISION_CONFLICT',
    message: 'TIP_REVISION_CONFLICT',
    details: { current_revision: 1 },
  });
  expect(await tipQuiet(f, visit.sessionId, key)).toEqual({
    revisions: 1,
    entries: 1,
    audits: 1,
    events: 1,
    keys: 0,
  });
});

it('a duplicate pair, a zero amount and an amount over the money max fail validation', async () => {
  const visit = await recordVisit(f);
  const entry = tip(f, 0, 'CASH', '1.000');
  const inputs = [
    tipInput([entry, { ...entry }]),
    tipInput([tip(f, 0, 'CASH', '0.000')]),
    tipInput([tip(f, 0, 'CARD', '100000000000.000')]),
  ];
  for (const input of inputs) {
    const key = ids.newId();
    expect(errorShape(await caught(runTips(f, visit.sessionId, input, { key }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual(QUIET);
  }
});

it('a recorder membership outside the caller is not found and writes nothing', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  const error = await caught(
    runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '1.000')], { recorder_membership_id: ids.newId() }),
      { key },
    ),
  );
  expect(errorShape(error)).toEqual(NOT_FOUND);
  expect(await tipQuiet(f, visit.sessionId, key)).toEqual(QUIET);
});

it('replay after a later revision and after the window closes returns the stored body', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  const fingerprint = 'a'.repeat(64);
  const input = tipInput([tip(f, 0, 'CASH', '1.500')]);
  const first = await runTips(f, visit.sessionId, input, { key, fingerprint });
  await runTips(
    f,
    visit.sessionId,
    tipInput([tip(f, 0, 'CASH', '2.500')], { expected_revision: 1, reason: 'later' }),
    { fingerprint: 'e'.repeat(64) },
  );
  const later = await runTips(f, visit.sessionId, input, { key, fingerprint });
  expect(JSON.stringify(later)).toBe(JSON.stringify(first));
  f.setAt(new Date('2026-12-15T08:00:00.000Z'));
  try {
    const fresh = await caught(
      runTips(
        f,
        visit.sessionId,
        tipInput([tip(f, 0, 'CASH', '3.000')], { expected_revision: 2, reason: 'too late' }),
        { fingerprint: 'f'.repeat(64) },
      ),
    );
    expect(errorShape(fresh).code).toBe('TIP_WINDOW_CLOSED');
    const closed = await runTips(f, visit.sessionId, input, { key, fingerprint });
    expect(JSON.stringify(closed)).toBe(JSON.stringify(first));
    expect((await tipRows(f, visit.sessionId)).revisions).toHaveLength(2);
  } finally {
    f.setAt(AT);
  }
});

it('a branch deactivated while the visit lock is held is not found and writes nothing', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  const held = await holdVisit(f, visit.sessionId);
  const pending = runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key });
  const owner = separateOwner(f);
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    await owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
    await held.release();
    expect(errorShape(await caught(pending))).toEqual(NOT_FOUND);
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual(QUIET);
  } finally {
    await held.release();
    await pending.catch(() => undefined);
    await owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
    await owner.end();
  }
});

it('a membership that expires while the visit lock is held is not found and writes nothing', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-15T09:00:00Z' WHERE company_id=${f.company} AND id=${f.membership}`;
  const held = await holdVisit(f, visit.sessionId);
  const pending = runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key });
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    f.setAt(new Date('2026-10-15T10:00:00.000Z'));
    await held.release();
    expect(errorShape(await caught(pending))).toEqual(NOT_FOUND);
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual(QUIET);
  } finally {
    await held.release();
    await pending.catch(() => undefined);
    f.setAt(AT);
    await f.h
      .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});
