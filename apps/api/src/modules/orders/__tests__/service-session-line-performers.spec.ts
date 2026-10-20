import { changeLinePerformersResponse, serviceLineChanged } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, ids, must } from './session.fixture.ts';
import { editBody, runEdit } from './line-edit.helpers.ts';
import {
  changeQuiet,
  changeRows,
  expectHidden,
  livePerformers,
  nineColumns,
  payloadOf,
  performersFixture,
  performersInput,
  runChange,
  seedWarnings,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('PC-01 a manager replaces the performers and shares, and the history, audit and event follow', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  const before = (await livePerformers(f, line.id)).map((row) => nineColumns(row));
  const reason = `sentinel-reason-${ids.newId()}`;
  const key = ids.newId();
  const result = changeLinePerformersResponse.parse(
    await runChange(f, visit.sessionId, line.id, performersInput({
      performers: [{ employee_id: must(f.employees[2]), share_bps: 6000 }, { employee_id: must(f.employees[0]), share_bps: 4000 }],
      reason,
    }), { key }),
  );
  expect(result).toMatchObject({
    line: { id: line.id, status: 'ACTIVE', revision: 2, price: '25.000', discount: '0.000', net: '25.000', recorded_by: f.userId, performers_changed_at: '2026-10-15' },
    session: { id: visit.sessionId, total_net: '25.000' },
  });
  expect(result.line.performers.map((row) => [row.employee_id, row.performer_ordinal, row.share_bps])).toEqual([
    [must(f.employees[2]), 1, 6000],
    [must(f.employees[0]), 2, 4000],
  ]);
  const saved = await changeRows(f, visit.sessionId, line.id);
  expect(saved.line).toMatchObject({ status: 'ACTIVE', revision: 2, price: '25.000', discount: '0.000', net: '25.000', has_performer_warning: true });
  expect(saved.headers).toHaveLength(1);
  expect(saved.headers[0]).toMatchObject({
    revision: 2, previous_revision: 1, reason, changed_by: f.editorId, changed_by_membership_id: f.editorMembership,
    changer_name_ar: 'ليلى', changer_name_en: 'Layla Editor', changer_role: 'branch_manager',
    changer_role_is_system: true, changer_role_name_en: 'Branch Manager', changer_role_name_ar: null,
  });
  expect(Number(saved.headers[0]?.['write_system_id'])).toBeGreaterThan(0);
  expect(Number(saved.headers[0]?.['write_xid'])).toBeGreaterThan(0);  expect(saved.sides.filter((row) => row['side'] === 'BEFORE').map((row) => nineColumns(row))).toEqual(before);
  expect(saved.sides.filter((row) => row['side'] === 'AFTER').map((row) => nineColumns(row)))
    .toEqual(saved.live.map((row) => nineColumns(row)));
  expect(payloadOf(must(saved.audits[0])['after'])).toMatchObject({
    session_id: visit.sessionId, line_id: line.id, revision_before: 1, revision_after: 2,
    changer_user_id: f.editorId, changer_membership_id: f.editorMembership, changed_at: AT.toISOString(),
    performers_before: [{ employee_id: must(f.employees[0]), share_bps: 10000 }],
    performers_after: [{ employee_id: must(f.employees[2]), share_bps: 6000 }, { employee_id: must(f.employees[0]), share_bps: 4000 }],
  });
  const event = serviceLineChanged.parse(payloadOf(must(saved.events[0])['payload']));
  expect(event.change?.kind).toBe('PERFORMERS_CHANGE');
  expect(event.change?.changed_by).toBe(f.editorId);
  expect(event.change?.changed_by_membership_id).toBe(f.editorMembership);
  expect(event.revision).toBe(2);
  expect(event.performers).toEqual([
    { employee_id: must(f.employees[2]), share_bps: 6000 },
    { employee_id: must(f.employees[0]), share_bps: 4000 },
  ]);
  expect(event.change?.previous).toEqual({
    revision: 1,
    performers: [{ employee_id: must(f.employees[0]), share_bps: 10000 }],
  });
  const [stored] = await f.h.owner`SELECT response_status FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(stored?.['response_status']).toBe(200);
  expect(await expectHidden(f, visit.sessionId, line.id, key, reason, result)).toBe(0);
});

it('PC-01 a second change keeps the old order in the before side and in the event', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  await runChange(f, visit.sessionId, line.id, performersInput({
    performers: [{ employee_id: must(f.employees[2]), share_bps: 6000 }, { employee_id: must(f.employees[0]), share_bps: 4000 }],
  }));
  const middle = (await livePerformers(f, line.id)).map((row) => nineColumns(row));
  await runChange(f, visit.sessionId, line.id, performersInput({
    expected_revision: 2,
    performers: [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: must(f.employees[2]), share_bps: 5000 }],
  }));
  const saved = await changeRows(f, visit.sessionId, line.id);
  expect(saved.headers).toHaveLength(2);
  expect(saved.headers.map((row) => [Number(row['revision']), Number(row['previous_revision'])])).toEqual([[2, 1], [3, 2]]);
  const before = saved.sides.filter((row) => Number(row['change_revision']) === 3 && row['side'] === 'BEFORE').map((row) => nineColumns(row));
  expect(before).toEqual(middle);
  expect(before.map((row) => row.employee_id)).toEqual([must(f.employees[2]), must(f.employees[0])]);
  const event = serviceLineChanged.parse(payloadOf(must(saved.events[1])['payload']));
  expect(event.change?.previous.performers).toEqual([
    { employee_id: must(f.employees[2]), share_bps: 6000 },
    { employee_id: must(f.employees[0]), share_bps: 4000 },
  ]);
});

it('PC-02 the money, the status, the other line and the visit total never move', async () => {
  const second = f.line(must(f.services[1]), '7.125', '0.000');
  const visit = await visitOf(f, [f.line(must(f.services[0]), '25.000', '0.000'), { ...second, performers: [{ employee_id: must(f.employees[1]) }] }]);
  const line = must(visit.lines[0]);
  const other = must(visit.lines[1]);
  const result = changeLinePerformersResponse.parse(
    await runChange(f, visit.sessionId, line.id, performersInput({ performers: [{ employee_id: must(f.employees[2]) }] })),
  );
  expect(result.session.total_net).toBe('32.125');
  expect(result.line.price).toBe('25.000');
  expect(result.line.discount).toBe('0.000');
  expect(result.line.net).toBe('25.000');
  expect(Object.hasOwn(result.line, 'edited')).toBe(false);
  const saved = await changeRows(f, visit.sessionId, line.id);
  expect(saved.line).toMatchObject({ status: 'ACTIVE', price: '25.000', discount: '0.000', net: '25.000' });
  const [untouched] = await f.h.owner`SELECT status,revision,price::text,discount::text,net::text
    FROM service_lines WHERE company_id=${f.company} AND id=${other.id}`;
  expect(untouched).toMatchObject({ status: 'ACTIVE', revision: 1, price: '7.125', discount: '0.000', net: '7.125' });
});

it('PC-02 a line whose price was edited keeps the edited mark', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  await runEdit(f, visit.sessionId, line.id, editBody({ price: '25.000', discount: { kind: 'AMOUNT', amount: '5.000' } }));
  const result = changeLinePerformersResponse.parse(
    await runChange(f, visit.sessionId, line.id, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[2]) }] })),
  );
  expect(result.line.edited).toBe(true);
  expect(result.line.revision).toBe(3);
  expect(result.line.price).toBe('25.000');
  expect(result.line.net).toBe('20.000');
});

it('PC-03 a swap, an addition, a removal and a shares-only change each succeed', async () => {
  const swap = await visitOf(f);
  expect(await runChange(f, swap.sessionId, must(swap.lines[0]).id, performersInput({
    performers: [{ employee_id: must(f.employees[1]) }],
  }))).toMatchObject({ line: { revision: 2 } });
  const addition = await visitOf(f);
  expect(await runChange(f, addition.sessionId, must(addition.lines[0]).id, performersInput({
    performers: [{ employee_id: must(f.employees[0]) }, { employee_id: must(f.employees[1]) }],
  }))).toMatchObject({ line: { revision: 2 } });
  const removal = await visitOf(f, [pairLine(f)]);
  expect(await runChange(f, removal.sessionId, must(removal.lines[0]).id, performersInput({
    performers: [{ employee_id: must(f.employees[0]) }],
  }))).toMatchObject({ line: { revision: 2 } });
  const shares = await visitOf(f, [sharedPairLine(f)]);
  expect(await runChange(f, shares.sessionId, must(shares.lines[0]).id, performersInput({
    performers: [{ employee_id: must(f.employees[0]), share_bps: 7000 }, { employee_id: must(f.employees[1]), share_bps: 3000 }],
  }))).toMatchObject({ line: { revision: 2 } });
});

it('PC-03 the same set and a reordering alone are refused and write nothing', async () => {
  const same = await visitOf(f);
  const sameLine = must(same.lines[0]).id;
  const sameKey = ids.newId();
  await expect(runChange(f, same.sessionId, sameLine, performersInput({
    performers: [{ employee_id: must(f.employees[0]) }],
  }), { key: sameKey })).rejects.toThrow('SESSION_PERFORMERS_NO_CHANGE');
  expect(await changeQuiet(f, same.sessionId, sameLine, sameKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  const order = await visitOf(f, [sharedPairLine(f)]);
  const orderLine = must(order.lines[0]).id;
  const orderKey = ids.newId();
  await expect(runChange(f, order.sessionId, orderLine, performersInput({
    performers: [{ employee_id: must(f.employees[1]), share_bps: 5000 }, { employee_id: must(f.employees[0]), share_bps: 5000 }],
  }), { key: orderKey })).rejects.toThrow('SESSION_PERFORMERS_NO_CHANGE');
  expect(await changeQuiet(f, order.sessionId, orderLine, orderKey)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  expect((await livePerformers(f, orderLine)).map((row) => row['employee_id'])).toEqual([must(f.employees[0]), must(f.employees[1])]);
});

it('PC-04 omitted shares split equally and the remainder goes to the first', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  const result = changeLinePerformersResponse.parse(await runChange(f, visit.sessionId, line.id, performersInput({
    performers: [{ employee_id: must(f.employees[0]) }, { employee_id: must(f.employees[1]) }, { employee_id: must(f.employees[2]) }],
  })));
  expect(result.line.performers.map((row) => row.share_bps)).toEqual([3334, 3333, 3333]);
});

it('PC-04 a mixed, a zero, a wrong sum, an empty, a five and a duplicate set are refused', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]);
  const before = await livePerformers(f, line.id);
  const sets = [
    [{ employee_id: must(f.employees[0]), share_bps: 7000 }, { employee_id: must(f.employees[1]) }],
    [{ employee_id: must(f.employees[0]), share_bps: 0 }, { employee_id: must(f.employees[1]), share_bps: 10000 }],
    [{ employee_id: must(f.employees[0]), share_bps: 6000 }, { employee_id: must(f.employees[1]), share_bps: 3000 }],
    [],
    Array.from({ length: 5 }, (_, index) => ({ employee_id: `01990000-0000-7000-8000-00000000000${index}`, share_bps: 2000 })),
    [{ employee_id: must(f.employees[0]), share_bps: 5000 }, { employee_id: must(f.employees[0]), share_bps: 5000 }],
  ];
  for (const performers of sets) {
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line.id, performersInput({ performers }), { key })).rejects.toThrow('SESSION_PERFORMER_SHARES_INVALID');
    expect(await changeQuiet(f, visit.sessionId, line.id, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  }
  expect(await livePerformers(f, line.id)).toEqual(before);
});

function pairLine(fixture: PerformersFixture) {
  return {
    ...fixture.line(must(fixture.services[0]), '25.000', '0.000'),
    performers: [{ employee_id: must(fixture.employees[0]) }, { employee_id: must(fixture.employees[1]) }],
  };
}

function sharedPairLine(fixture: PerformersFixture) {
  return {
    ...fixture.line(must(fixture.services[0]), '25.000', '0.000'),
    performers: [
      { employee_id: must(fixture.employees[0]), share_bps: 5000 },
      { employee_id: must(fixture.employees[1]), share_bps: 5000 },
    ],
  };
}
