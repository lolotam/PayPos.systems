import { expect, it } from 'vitest';

import {
  PARKED_ALERT_CONSUMER_ID,
  RaiseParkedCommissionAlert,
} from '../use-cases/raise-parked-commission-alert/raise-parked-commission-alert.ts';
import type { ParkedAlertNotice } from '../ports/parked-commission-alert.port.ts';

type FakeTx = { readonly companyId: string };

const owner = (index: number): string => `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`;
const EVENT = {
  companyId: '01920000-0000-7000-8000-0000000000a0',
  eventId: '01920000-0000-7000-8000-0000000000b1',
  eventType: 'SessionTipsChanged',
};

const harness = (
  options: { owners?: readonly string[]; marked?: boolean; projected?: boolean } = {},
) => {
  const owners = options.owners ?? [owner(1)];
  const marked = options.marked ?? true;
  const projected = options.projected ?? false;
  const marks: { consumerId: string; eventId: string }[] = [];
  const notices: ParkedAlertNotice[] = [];
  const transactions: string[] = [];
  const projections: string[] = [];
  const useCase = new RaiseParkedCommissionAlert<FakeTx>({
    withTenant: async (companyId, fn) => {
      transactions.push(companyId);
      return fn({ companyId });
    },
    owners: async () => owners,
    isInputProjected: async (_tx, eventId) => {
      projections.push(eventId);
      return projected;
    },
    markConsumed: async (_tx, consumerId, eventId) => {
      marks.push({ consumerId, eventId });
      return marked;
    },
    appendNotice: async (_tx, notice) => {
      notices.push(notice);
    },
    now: () => new Date('2026-11-24T09:00:00Z'),
    groupSize: 100,
  });
  return { useCase, marks, notices, transactions, projections };
};

it('raises one bell for the owners of a counted event that stopped', async () => {
  const { useCase, marks, notices, transactions } = harness();
  expect(await useCase.execute(EVENT)).toBe('ALERTED');
  expect(transactions).toEqual([EVENT.companyId]);
  expect(marks).toEqual([{ consumerId: PARKED_ALERT_CONSUMER_ID, eventId: EVENT.eventId }]);
  expect(notices).toEqual([
    {
      eventId: EVENT.eventId,
      eventType: EVENT.eventType,
      groupIndex: 0,
      recipients: [owner(1)],
    },
  ]);
});

it('raises nothing for an event that does not block an approval', async () => {
  const { useCase, marks, notices, transactions } = harness();
  expect(await useCase.execute({ ...EVENT, eventType: 'BusinessCreated' })).toBe(
    'NOT_A_COMMISSION_EVENT',
  );
  expect(transactions).toEqual([]);
  expect(marks).toEqual([]);
  expect(notices).toEqual([]);
});

it('raises no bell and writes no mark for a company with no owner', async () => {
  const { useCase, marks, notices } = harness({ owners: [] });
  expect(await useCase.execute(EVENT)).toBe('NO_OWNERS');
  expect(marks).toEqual([]);
  expect(notices).toEqual([]);
});

it('raises no second bell for the same stopped event', async () => {
  const { useCase, marks, notices } = harness({ marked: false });
  expect(await useCase.execute(EVENT)).toBe('ALREADY_ALERTED');
  expect(marks).toEqual([{ consumerId: PARKED_ALERT_CONSUMER_ID, eventId: EVENT.eventId }]);
  expect(notices).toEqual([]);
});

it('raises one bell per group when the company has more owners than one group', async () => {
  const owners = Array.from({ length: 101 }, (_, index) => owner(index));
  const { useCase, notices } = harness({ owners });
  expect(await useCase.execute(EVENT)).toBe('ALERTED');
  expect(notices).toHaveLength(2);
  expect(notices[0]?.recipients).toHaveLength(100);
  expect(notices[1]?.recipients).toEqual([owner(100)]);
  expect(notices.map((notice) => notice.groupIndex)).toEqual([0, 1]);
});

it('marks a projected event and raises no bell, because it no longer blocks the approval', async () => {
  const { useCase, marks, notices, projections } = harness({ projected: true });
  expect(await useCase.execute(EVENT)).toBe('NOT_BLOCKING');
  expect(projections).toEqual([EVENT.eventId]);
  expect(marks).toEqual([{ consumerId: PARKED_ALERT_CONSUMER_ID, eventId: EVENT.eventId }]);
  expect(notices).toEqual([]);
});

it('raises no bell and no second mark for a projected event that was already marked', async () => {
  const { useCase, marks, notices } = harness({ projected: true, marked: false });
  expect(await useCase.execute(EVENT)).toBe('ALREADY_ALERTED');
  expect(marks).toEqual([{ consumerId: PARKED_ALERT_CONSUMER_ID, eventId: EVENT.eventId }]);
  expect(notices).toEqual([]);
});

it('does not read the owners of a projected event', async () => {
  const { useCase } = harness({ projected: true, owners: [] });
  expect(await useCase.execute(EVENT)).toBe('NOT_BLOCKING');
});
