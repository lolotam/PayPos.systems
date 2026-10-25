import type { TenantWrappers, Tx } from '@pospay/db';
import { expect, it } from 'vitest';

import type { BranchPlaceReader } from '../../ports/branch-place.port.ts';
import type {
  StatementIdentityReader,
  StatementOpenSessionsReader,
} from '../../ports/attendance-statement.port.ts';
import {
  STATEMENT_READ_TIMEOUT_MS,
  attendanceStatementTransactions,
} from '../attendance-statement.transactions.ts';

const REQUEST = {
  business_id: '01920000-0000-7000-8000-0000000000b2',
  branch_id: '01920000-0000-7000-8000-0000000000a2',
  form: 'EMPLOYEE',
  employee_id: '01920000-0000-7000-8000-0000000000c3',
  period_from: '2026-10-01',
  period_to: '2026-10-03',
  language: 'ar',
  shift_start: null,
  shift_end: null,
  logo_file_id: null,
  requested_by: '01920000-0000-7000-8000-0000000000d4',
  requested_at: new Date('2026-10-04T08:00:00.000Z'),
};

/** سجلّ الجمل اللي اتنفذت في المعاملة والقراءات اللي اتنادت. */
interface Recorder {
  readonly statements: string[];
  readonly readers: string[];
}

function fakeReaders(recorder: Recorder, abortAt?: 'branch' | 'identity', abort?: () => void) {
  const identity: StatementIdentityReader<Tx> = {
    read: async () => {
      recorder.readers.push('identity');
      if (abortAt === 'identity') abort?.();
      return { official_name_ar: null, official_name_en: null, logo_file_id: null };
    },
  };
  const branchPlace: BranchPlaceReader<Tx> = {
    forBranch: async () => {
      recorder.readers.push('branch');
      if (abortAt === 'branch') abort?.();
      return {
        nameAr: 'السالمية',
        nameEn: 'Salmiya',
        timeZone: 'Asia/Kuwait',
        businessNameAr: 'صالون الأميرة',
        businessNameEn: 'Princess Salon',
      };
    },
  };
  const openSessions: StatementOpenSessionsReader<Tx> = async () => {
    recorder.readers.push('open');
    return [];
  };
  return { identity, branchPlace, openSessions };
}

function fakeDatabase(recorder: Recorder): Pick<TenantWrappers, 'withTenant'> {
  const tx = {
    execute: async (statement: unknown) => {
      recorder.statements.push(String(statement));
      return [REQUEST];
    },
  } as unknown as Tx;
  return {
    withTenant: async (_companyId: string, callback: (tx: Tx) => Promise<unknown>) => callback(tx),
  } as unknown as Pick<TenantWrappers, 'withTenant'>;
}

it('the first statement in the transaction bounds the time of one statement', async () => {
  const recorder: Recorder = { statements: [], readers: [] };
  const readers = fakeReaders(recorder);
  const reader = attendanceStatementTransactions(
    fakeDatabase(recorder),
    readers.identity,
    readers.branchPlace,
    readers.openSessions,
  );
  await reader.read('company', 'render');
  expect(recorder.statements[0]).toContain('SET LOCAL statement_timeout');
  expect(recorder.statements[0]).toContain(`${STATEMENT_READ_TIMEOUT_MS}ms`);
});

it('an aborted render stops at the next read and never runs the reads after it', async () => {
  const controller = new AbortController();
  const recorder: Recorder = { statements: [], readers: [] };
  const readers = fakeReaders(recorder, 'branch', () => controller.abort());
  const reader = attendanceStatementTransactions(
    fakeDatabase(recorder),
    readers.identity,
    readers.branchPlace,
    readers.openSessions,
  );
  await expect(reader.read('company', 'render', controller.signal)).rejects.toThrow();
  expect(recorder.readers).toEqual(['open', 'branch']);
});

it('a signal aborted after the last read still refuses the result', async () => {
  const controller = new AbortController();
  const recorder: Recorder = { statements: [], readers: [] };
  const readers = fakeReaders(recorder, 'identity', () => controller.abort());
  const reader = attendanceStatementTransactions(
    fakeDatabase(recorder),
    readers.identity,
    readers.branchPlace,
    readers.openSessions,
  );
  await expect(reader.read('company', 'render', controller.signal)).rejects.toThrow();
  expect(recorder.readers).toEqual(['open', 'branch', 'identity']);
});
