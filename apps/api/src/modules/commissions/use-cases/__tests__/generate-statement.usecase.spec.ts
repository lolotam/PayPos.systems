import { StatementPeriodClosedError } from '@pospay/db';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import type {
  CommissionStatementGenerateCommand,
  CommissionStatementGenerateScope,
  CommissionStatementGenerateTransactions,
  CommissionStatementSource,
} from '../../ports/commission-statement.port.ts';
import { CanonicalSha256FingerprintHasher } from '../../persistence/canonical-sha256-fingerprint-hasher.ts';
import { computeStatement } from '../compute-statement-view/compute-statement-view.ts';
import { GenerateCommissionStatementUseCase } from '../generate-statement/generate-statement.usecase.ts';
import { BUSINESS, PERIOD, statementRecord, statementSource } from './statement-source.fixture.ts';

const hasher = new CanonicalSha256FingerprintHasher();
const command: CommissionStatementGenerateCommand = {
  companyId: 'c',
  userId: 'u',
  businessId: BUSINESS,
  period: PERIOD,
  key: 'k',
  fingerprint: 'f',
};
// 1 نوفمبر بتوقيت الكويت: أكتوبر خلص، ونوفمبر لسه ما خلصش.
const kuwaitNovember: Clock = { now: () => new Date('2026-11-01T10:00:00Z') };
const kuwaitOctober: Clock = { now: () => new Date('2026-10-31T10:00:00Z') };

interface Recorder {
  readonly calls: string[];
  readonly stored: { period: string; fingerprint: string }[];
  readonly audits: { period: string; input: string; statement: string }[];
}

/** نطاق كتابة بيسجّل كل خطوة بترتيبها، ومعاه نقاط الفشل اللي الاختبار بيطلبها. */
function recordingScope(
  source: CommissionStatementSource,
  options: { lockError?: Error; access?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null } = {},
): { scope: CommissionStatementGenerateScope; recorder: Recorder } {
  const recorder: Recorder = { calls: [], stored: [], audits: [] };
  const scope: CommissionStatementGenerateScope = {
    timeZone: async () => (recorder.calls.push('timeZone'), 'Asia/Kuwait'),
    lockPeriod: async () => {
      recorder.calls.push('lockPeriod');
      if (options.lockError !== undefined) throw options.lockError;
    },
    recheckAccess: async () => (recorder.calls.push('recheckAccess'), options.access ?? null),
    readSource: async () => (recorder.calls.push('readSource'), source),
    storeCurrentFingerprint: async (period, fingerprint) => {
      recorder.calls.push('storeCurrentFingerprint');
      recorder.stored.push({ period, fingerprint });
    },
    audit: async (period, fingerprints) => {
      recorder.calls.push('audit');
      recorder.audits.push({ period, ...fingerprints });
    },
  };
  return { scope, recorder };
}

const run = (
  scope: CommissionStatementGenerateScope,
  clock: Clock = kuwaitNovember,
) => {
  const transactions: CommissionStatementGenerateTransactions = {
    run: (_command, work) => work(scope),
  };
  return new GenerateCommissionStatementUseCase(transactions, hasher, clock).execute(command);
};

describe('generating a month that has not ended (CM-29)', () => {
  it('refuses with COMMISSION_PERIOD_NOT_ENDED before any lock, read or write', async () => {
    const { scope, recorder } = recordingScope(statementSource(statementRecord()));
    await expect(run(scope, kuwaitOctober)).rejects.toMatchObject({
      code: 'COMMISSION_PERIOD_NOT_ENDED',
    });
    expect(recorder.calls).toEqual(['timeZone']);
  });
});

describe('generating a month that has ended (CM-27, CM-28)', () => {
  it('runs the steps in order: lock, access recheck, read, store, audit', async () => {
    const { scope, recorder } = recordingScope(statementSource(statementRecord()));
    await run(scope);
    expect(recorder.calls).toEqual([
      'timeZone',
      'lockPeriod',
      'recheckAccess',
      'readSource',
      'storeCurrentFingerprint',
      'audit',
    ]);
  });

  it('stores the input fingerprint the read use case would compute, and returns it as generated', async () => {
    const source = statementSource(statementRecord());
    const { scope, recorder } = recordingScope(source);
    const view = await run(scope);
    const expected = computeStatement(PERIOD, source, hasher);
    expect(recorder.stored).toEqual([{ period: PERIOD, fingerprint: expected.inputFingerprint }]);
    expect(view).toMatchObject({
      reader_scope: 'BUSINESS',
      generated: true,
      status: 'DRAFT',
      current_fingerprint: expected.inputFingerprint,
      current_statement_fingerprint: expected.statementFingerprint,
    });
  });

  it('writes an audit entry with both fingerprints and nothing else', async () => {
    const { scope, recorder } = recordingScope(statementSource(statementRecord()));
    const view = await run(scope);
    expect(recorder.audits).toEqual([
      {
        period: PERIOD,
        input: view.current_fingerprint,
        statement: view.current_statement_fingerprint,
      },
    ]);
  });

  it('gives the same fingerprints when generated twice with no input change', async () => {
    const first = await run(recordingScope(statementSource(statementRecord())).scope);
    const second = await run(recordingScope(statementSource(statementRecord())).scope);
    expect([second.current_fingerprint, second.current_statement_fingerprint]).toEqual([
      first.current_fingerprint,
      first.current_statement_fingerprint,
    ]);
  });
});

describe('generating on a statement that is already reviewed (D-5, FR-029)', () => {
  it('stores the current input fingerprint only and leaves the status and reviewed values as they were', async () => {
    const reviewed = statementRecord({
      status: 'REVIEWED',
      currentFingerprint: 'a'.repeat(64),
      reviewedFingerprint: 'c'.repeat(64),
      reviewedStatementFingerprint: 'd'.repeat(64),
    });
    const { scope, recorder } = recordingScope(statementSource(reviewed));
    const view = await run(scope);
    expect(view).toMatchObject({
      status: 'REVIEWED',
      reviewed_fingerprint: 'c'.repeat(64),
      reviewed_statement_fingerprint: 'd'.repeat(64),
      changed_since_review: true,
    });
    expect(recorder.stored).toHaveLength(1);
    expect(recorder.calls.filter((call) => call.startsWith('store'))).toEqual([
      'storeCurrentFingerprint',
    ]);
  });
});

describe('generating on a closed month or after the access was withdrawn', () => {
  it.each(['APPROVED', 'PAID'] as const)('refuses a %s month and writes nothing', async (status) => {
    const closed = statementSource(statementRecord({ status }));
    const { scope, recorder } = recordingScope(closed, {
      lockError: new StatementPeriodClosedError([PERIOD]),
    });
    await expect(run(scope)).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });
    expect(recorder.stored).toEqual([]);
    expect(recorder.audits).toEqual([]);
  });

  it('refuses with the uniform 403 when the access check after the lock fails, and writes nothing', async () => {
    const { scope, recorder } = recordingScope(statementSource(statementRecord()), {
      access: 'FORBIDDEN',
    });
    await expect(run(scope)).rejects.toBeInstanceOf(CommissionPlanVersionError);
    expect(recorder.calls).not.toContain('readSource');
    expect(recorder.stored).toEqual([]);
    expect(recorder.audits).toEqual([]);
  });

  it('refuses a disabled feature after the lock the same way', async () => {
    const { scope, recorder } = recordingScope(statementSource(statementRecord()), {
      access: 'FEATURE_DISABLED',
    });
    await expect(run(scope)).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(recorder.stored).toEqual([]);
  });
});
