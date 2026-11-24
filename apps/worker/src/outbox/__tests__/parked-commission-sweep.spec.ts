import { Writable } from 'node:stream';

import type { ParkedCommissionOutboxRow } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { createParkedCommissionSweep } from '../parked-commission-sweep.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';

const row = (seq: number): ParkedCommissionOutboxRow => ({
  companyId: COMPANY,
  id: `01970000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
  eventType: 'SalaryChanged',
  seq: String(seq),
});

const pages = (rows: readonly ParkedCommissionOutboxRow[]) =>
  async (afterSeq: string | bigint, limit: number): Promise<readonly ParkedCommissionOutboxRow[]> => {
    const cursor = BigInt(afterSeq.toString());
    return rows.filter((candidate) => BigInt(candidate.seq) > cursor).slice(0, limit);
  };

/** رافع تنبيه زي الـproduction: بيسجّل أول مرة وبيرجع 'ALREADY_ALERTED' تاني مرة. */
const notifier = () => {
  const notices: string[] = [];
  const calls: { id: string; outcome: string }[] = [];
  const marked = new Set<string>();
  return {
    notices,
    calls,
    raiseAlert: async (event: { readonly eventId: string }) => {
      if (marked.has(event.eventId)) {
        calls.push({ id: event.eventId, outcome: 'ALREADY_ALERTED' });
        return 'ALREADY_ALERTED' as const;
      }
      marked.add(event.eventId);
      calls.push({ id: event.eventId, outcome: 'ALERTED' });
      notices.push(event.eventId);
      return 'ALERTED' as const;
    },
  };
};

const capture = () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return {
    lines,
    logger: createLogger('info', { destination: sink, events: WORKER_LOG_EVENTS }),
  };
};

it('skips a settled event without opening a second transaction', async () => {
  const rows = [row(1)];
  const { notices, calls, raiseAlert } = notifier();
  const { logger } = capture();
  const sweep = createParkedCommissionSweep({ readPage: pages(rows), raiseAlert, logger });
  await sweep();
  await sweep();
  expect(calls).toHaveLength(1);
  expect(notices).toEqual([rows[0]?.id]);
});

it('re-checks an evicted event and raises no second notice for it', async () => {
  const rows = [row(1), row(2)];
  const { notices, calls, raiseAlert } = notifier();
  const { logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert,
    logger,
    settledCapacity: 1,
  });
  await sweep();
  await sweep();
  expect(notices).toEqual([rows[0]?.id, rows[1]?.id]);
  expect(calls.slice(2).map((call) => call.outcome)).toEqual(['ALREADY_ALERTED', 'ALREADY_ALERTED']);
});

it('stops at the transaction cap and reaches the rest on the next sweep', async () => {
  const rows = [row(1), row(2), row(3)];
  const { notices, raiseAlert } = notifier();
  const { logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert,
    logger,
    maxTransactionsPerSweep: 2,
  });
  await sweep();
  expect(notices).toEqual([rows[0]?.id, rows[1]?.id]);
  await sweep();
  expect(notices).toEqual([rows[0]?.id, rows[1]?.id, rows[2]?.id]);
});

it('logs the transaction cap once and stops the sweep', async () => {
  const rows = [row(1), row(2)];
  const { raiseAlert } = notifier();
  const { lines, logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert,
    logger,
    maxTransactionsPerSweep: 1,
  });
  await sweep();
  expect(lines.filter((line) => line.includes('reached transaction cap'))).toHaveLength(1);
});

it('logs a company with no owner once and retries it on the next sweep', async () => {
  const rows = [row(1)];
  const calls: string[] = [];
  const { lines, logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert: async (event) => {
      calls.push(event.eventId);
      return 'NO_OWNERS' as const;
    },
    logger,
  });
  await sweep();
  await sweep();
  expect(calls).toEqual([rows[0]?.id, rows[0]?.id]);
  expect(lines.filter((line) => line.includes('has no recipient'))).toHaveLength(1);
});

it('keeps going after a failing event and retries it on the next sweep', async () => {
  const rows = [row(1), row(2)];
  const attempts: string[] = [];
  const { lines, logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert: async (event) => {
      attempts.push(event.eventId);
      if (event.eventId === rows[0]?.id) throw new Error('synthetic failure');
      return 'ALERTED' as const;
    },
    logger,
  });
  await sweep();
  expect(attempts).toEqual([rows[0]?.id, rows[1]?.id]);
  await sweep();
  expect(attempts).toEqual([rows[0]?.id, rows[1]?.id, rows[0]?.id]);
  expect(lines.filter((line) => line.includes('outbox park alert failed'))).toHaveLength(1);
});

it('logs a repeated failure again once the cooldown has passed', async () => {
  const rows = [row(1)];
  let clock = 0;
  const { lines, logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert: async () => {
      throw new Error('synthetic failure');
    },
    logger,
    now: () => clock,
    failureLogCooldownMs: 1_000,
  });
  await sweep();
  clock = 2_000;
  await sweep();
  expect(lines.filter((line) => line.includes('outbox park alert failed'))).toHaveLength(2);
});

it('reads every page of a parked backlog before it stops', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => row(index + 1));
  const { notices, raiseAlert } = notifier();
  const { logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert,
    logger,
    pageSize: 2,
  });
  await sweep();
  expect(notices).toHaveLength(5);
});

it('stops when the worker is stopping', async () => {
  const rows = [row(1)];
  const { notices, raiseAlert } = notifier();
  const { logger } = capture();
  const sweep = createParkedCommissionSweep({
    readPage: pages(rows),
    raiseAlert,
    logger,
    isStopped: () => true,
  });
  await sweep();
  expect(notices).toEqual([]);
});
