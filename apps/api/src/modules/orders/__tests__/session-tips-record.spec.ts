import { sessionTips, sessionTipsChanged } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  must,
  payloadOf,
  recordVisit,
  refusedTips,
  runTips,
  tip,
  tipFixture,
  tipInput,
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

it('TP-01 writes one revision, its entries, one audit and one outbox row in one transaction', async () => {
  const visit = await recordVisit(f);
  const saved = sessionTips.parse(
    await runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '1.500'), tip(f, 0, 'CARD', '2.250')]),
    ),
  );
  const rows = await tipRows(f, visit.sessionId);
  const revision = must(rows.revisions[0]);
  const event = must(rows.events[0]);
  const audit = must(rows.audits[0]);
  expect(rows.revisions).toHaveLength(1);
  expect(rows.entries).toHaveLength(2);
  expect(rows.audits).toHaveLength(1);
  expect(rows.events).toHaveLength(1);
  expect(saved.revision).toBe(1);
  expect(event['id']).toBe(revision['event_id']);
  expect(String(event['xmin'])).toBe(String(revision['xmin']));
  expect(String(audit['xmin'])).toBe(String(revision['xmin']));
  expect(audit['action']).toBe('tips.recorded');
  expect(audit['before']).toBeNull();
  expect(revision['changed_by']).toBe(f.userId);
  expect(sessionTipsChanged.parse(payloadOf(event['payload'])).revision).toBe(1);
});

it('TP-02 stores exactly the amounts the cashier sent', async () => {
  const visit = await recordVisit(f, twoLines(f));
  const sent = [tip(f, 0, 'CASH', '3.250'), tip(f, 1, 'CARD', '4.500')];
  await runTips(f, visit.sessionId, tipInput(sent));
  const rows = await tipRows(f, visit.sessionId);
  const stored = rows.entries.map((entry) => ({
    employee_id: entry['employee_id'],
    method: entry['method'],
    amount: entry['amount'],
  }));
  expect(stored).toHaveLength(sent.length);
  expect(stored).toEqual(expect.arrayContaining(sent));
});

it('TP-09 an empty replacement writes a revision with no entries and an empty event', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  const cleared = sessionTips.parse(
    await runTips(
      f,
      visit.sessionId,
      tipInput([], { expected_revision: 1, reason: 'clear the set' }),
    ),
  );
  const rows = await tipRows(f, visit.sessionId);
  const revision = must(rows.revisions.find((row) => row['revision'] === 2));
  const event = must(rows.events.find((row) => row['id'] === revision['event_id']));
  expect(cleared).toMatchObject({
    revision: 2,
    tips: [],
    total_cash: '0.000',
    total_card: '0.000',
  });
  expect(rows.entries.filter((entry) => entry['revision_id'] === revision['id'])).toHaveLength(0);
  expect(sessionTipsChanged.parse(payloadOf(event['payload'])).tips).toEqual([]);
});

it('TP-12 refuses a total past the money ceiling and accepts a tip above the visit net', async () => {
  const visit = await recordVisit(f, twoLines(f));
  expect(
    (
      await refusedTips(
        f,
        visit.sessionId,
        tipInput([tip(f, 0, 'CARD', '50000000000.000'), tip(f, 1, 'CARD', '50000000000.000')]),
      )
    ).code,
  ).toBe('TIP_TOTAL_TOO_LARGE');
  const saved = sessionTips.parse(
    await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '100.000')])),
  );
  expect(saved).toMatchObject({ revision: 1, total_cash: '100.000', total_card: '0.000' });
});

it('TP-13 the event and the audit carry no phone, customer name or reason, and money is canonical', async () => {
  const visit = await recordVisit(f);
  const reason = `sentinel-reason-${visit.sessionId}`;
  const saved = sessionTips.parse(
    await runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '1.500'), tip(f, 0, 'CARD', '2.250')], { reason }),
    ),
  );
  const rows = await tipRows(f, visit.sessionId);
  const event = sessionTipsChanged.parse(payloadOf(must(rows.events[0])['payload']));
  const blob = JSON.stringify({ saved, audits: rows.audits, event });
  expect(blob).not.toContain(reason);
  expect(blob).not.toContain('Synthetic customer');
  expect(blob).not.toContain('+999999998123');
  expect(must(rows.revisions[0])['reason']).toBe(reason);
  expect(saved).toMatchObject({ total_cash: '1.500', total_card: '2.250' });
  expect(event.tips.map((entry) => entry.amount)).toEqual(['2.250', '1.500']);
});
