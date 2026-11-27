import { describe, expect, it } from 'vitest';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type {
  ClosedStatementPayment,
  CommissionStatementReader,
} from '../ports/commission-statement.port.ts';
import { CanonicalSha256FingerprintHasher } from '../persistence/canonical-sha256-fingerprint-hasher.ts';
import { computeStatement } from '../use-cases/compute-statement-view/compute-statement-view.ts';
import { GetCommissionStatementUseCase } from '../use-cases/get-statement/get-statement.usecase.ts';
import {
  BUSINESS,
  PERIOD,
  RANA,
  SALMIYA,
  statementRecord,
  statementSource,
} from './statement-source.fixture.ts';

const hasher = new CanonicalSha256FingerprintHasher();
const request = { companyId: 'c', userId: 'u', businessId: BUSINESS, period: PERIOD };

/** قارئ بيرجّع قراءة واحدة ثابتة، علشان اختبار حالة الاستخدام من غير داتابيز. */
function readerOf(
  result: Awaited<ReturnType<CommissionStatementReader['read']>>,
): CommissionStatementReader {
  return { read: async () => result };
}

const ok = (
  businessWide: boolean,
  statement = statementRecord(),
  branchIds: readonly string[] = [SALMIYA],
): Awaited<ReturnType<CommissionStatementReader['read']>> => ({
  kind: 'ok',
  read: { businessWide, branchIds, source: statementSource(statement), closed: null },
});

/** شهر مغلق بصفوفه المجمّدة: نفس صفوف الباني، ووقت اعتماد وبصمتين مخزّنتين. */
const closedRead = (
  businessWide: boolean,
  status: 'APPROVED' | 'PAID',
  payment: ClosedStatementPayment | null = null,
): Awaited<ReturnType<CommissionStatementReader['read']>> => {
  const computed = computeStatement(PERIOD, statementSource(), hasher);
  return {
    kind: 'ok',
    read: {
      businessWide,
      branchIds: [SALMIYA],
      source: statementSource(statementRecord({ status, currentFingerprint: 'a'.repeat(64) })),
      closed: {
        approvedAt: '2026-11-15T10:00:00.123456Z',
        inputFingerprint: computed.inputFingerprint,
        statementFingerprint: computed.statementFingerprint,
        rows: computed.build.rows,
        payment,
      },
    },
  };
};

const ELSEWHERE = '01920000-0000-7000-8000-0000000000e9';
/** صرف كاش لموظفتين: واحدة مرئية لفرع القارئ (رنا) وواحدة بره الفرع. */
const PAID_PAYMENT: ClosedStatementPayment = {
  paidOn: '2026-11-03',
  paidMethod: 'CASH',
  paidNote: 'with salary',
  paidAt: '2026-11-07T09:00:00.000Z',
  paidBy: '01920000-0000-7000-8000-0000000000f1',
  payments: [
    { employeeId: RANA, exactPayable: '41.003', paidAmount: '41.005' },
    { employeeId: ELSEWHERE, exactPayable: '10.000', paidAmount: '10.000' },
  ],
};

const view = (reader: CommissionStatementReader) =>
  new GetCommissionStatementUseCase(reader, hasher).execute(request);

describe('the read use case has reader ports only (D-25)', () => {
  it('takes exactly a reader and a hasher, and the reader exposes one read method', async () => {
    const reader = readerOf(ok(true));
    const useCase = new GetCommissionStatementUseCase(reader, hasher);
    expect(GetCommissionStatementUseCase.length).toBe(2);
    expect(Object.keys(useCase).sort()).toEqual(['hasher', 'reader']);
    expect(Object.keys(reader)).toEqual(['read']);
  });

  it('writes nothing: a call only reads through the reader once', async () => {
    let reads = 0;
    const reader: CommissionStatementReader = {
      read: async () => {
        reads += 1;
        return ok(true);
      },
    };
    await view(reader);
    expect(reads).toBe(1);
  });
});

describe('the two response shapes (FR-025, CM-28c)', () => {
  it('gives a business-wide reader both current fingerprints and the review fields', async () => {
    const response = await view(readerOf(ok(true)));
    expect(response.reader_scope).toBe('BUSINESS');
    expect(Object.keys(response)).toEqual(
      expect.arrayContaining([
        'current_fingerprint',
        'current_statement_fingerprint',
        'reviewed_fingerprint',
        'reviewed_statement_fingerprint',
        'changed_since_review',
        'change_cause',
      ]),
    );
  });

  it('gives a branch reader the status and her rows only, with no whole-statement field', async () => {
    const response = await view(readerOf(ok(false)));
    expect(response.reader_scope).toBe('BRANCHES');
    expect(Object.keys(response).sort()).toEqual(
      ['business_id', 'employees', 'generated', 'period', 'reader_scope', 'status'].sort(),
    );
  });

  it('gives a union of branch grants that covers every branch the branch shape, never the whole one', async () => {
    const response = await view(readerOf(ok(false, statementRecord(), [SALMIYA, 'other'])));
    expect(response.reader_scope).toBe('BRANCHES');
  });
});

describe('generated and changed since review (R6, D-6)', () => {
  it('is not generated while current_fingerprint is null, and generated once it is stored', async () => {
    expect(((await view(readerOf(ok(true)))) as { generated: boolean }).generated).toBe(false);
    const stored = statementRecord({ currentFingerprint: 'a'.repeat(64) });
    expect(((await view(readerOf(ok(true, stored)))) as { generated: boolean }).generated).toBe(true);
  });

  it('reports no change when both reviewed fingerprints equal the ones computed now', async () => {
    const now = computeStatement(PERIOD, statementSource(), hasher);
    const reviewed = statementRecord({
      status: 'REVIEWED',
      reviewedFingerprint: now.inputFingerprint,
      reviewedStatementFingerprint: now.statementFingerprint,
    });
    const response = await view(readerOf(ok(true, reviewed)));
    expect(response).toMatchObject({ status: 'REVIEWED', changed_since_review: false, change_cause: null });
  });

  it('names INPUTS when the input fingerprint moved, even if the statement one moved too', async () => {
    const reviewed = statementRecord({
      status: 'REVIEWED',
      reviewedFingerprint: 'a'.repeat(64),
      reviewedStatementFingerprint: 'b'.repeat(64),
    });
    expect(await view(readerOf(ok(true, reviewed)))).toMatchObject({
      changed_since_review: true,
      change_cause: 'INPUTS',
    });
  });

  it('names STATEMENT when only the statement fingerprint moved (a label or branch link)', async () => {
    const now = computeStatement(PERIOD, statementSource(), hasher);
    const reviewed = statementRecord({
      status: 'REVIEWED',
      reviewedFingerprint: now.inputFingerprint,
      reviewedStatementFingerprint: 'b'.repeat(64),
    });
    expect(await view(readerOf(ok(true, reviewed)))).toMatchObject({
      changed_since_review: true,
      change_cause: 'STATEMENT',
    });
  });

  it('computes the same fingerprints on every read of the same inputs', async () => {
    const first = await view(readerOf(ok(true)));
    const second = await view(readerOf(ok(true)));
    expect(second).toEqual(first);
  });
});

describe('a closed month is read from its frozen rows (FR-025, FR-033)', () => {
  it.each(['APPROVED', 'PAID'] as const)('gives a business-wide reader the frozen %s view with the stored fingerprints', async (status) => {
    const response = await view(readerOf(closedRead(true, status)));

    expect(response).toMatchObject({
      reader_scope: 'BUSINESS',
      status,
      approved_at: '2026-11-15T10:00:00.123456Z',
    });
    expect(response).not.toHaveProperty('current_fingerprint');
  });

  it('gives a branch reader the closed branch shape with no whole-statement field', async () => {
    const response = await view(readerOf(closedRead(false, 'APPROVED')));

    expect(Object.keys(response).sort()).toEqual([
      'business_id',
      'employees',
      'payment',
      'period',
      'reader_scope',
      'status',
    ]);
  });

  it('shows a paid month its payment: all rows and the total to the business-wide reader, only her rows to a branch reader (FR-037)', async () => {
    const payment = PAID_PAYMENT;
    const elsewhere = ELSEWHERE;

    const business = await view(readerOf(closedRead(true, 'PAID', payment)));
    const branch = await view(readerOf(closedRead(false, 'PAID', payment)));

    expect(business).toMatchObject({
      payment: {
        paid_on: '2026-11-03',
        paid_method: 'CASH',
        paid_total: '51.005',
        paid_by: payment.paidBy,
        payments: [
          { employee_id: RANA, exact_payable: '41.003', paid_amount: '41.005' },
          { employee_id: elsewhere, exact_payable: '10.000', paid_amount: '10.000' },
        ],
      },
    });
    expect(branch).toMatchObject({
      payment: {
        paid_on: '2026-11-03',
        paid_method: 'CASH',
        payments: [{ employee_id: RANA, exact_payable: '41.003', paid_amount: '41.005' }],
      },
    });
    expect(Object.keys((branch as { payment: object }).payment).sort()).toEqual([
      'paid_method',
      'paid_on',
      'payments',
    ]);
  });

  it('has no payment on an approved month', async () => {
    expect(await view(readerOf(closedRead(true, 'APPROVED')))).toMatchObject({ payment: null });
    expect(await view(readerOf(closedRead(false, 'APPROVED')))).toMatchObject({ payment: null });
  });

  it('refuses to guess when a closed month reaches the use case without its frozen rows', async () => {
    const stray = ok(true, statementRecord({ status: 'APPROVED', currentFingerprint: 'a'.repeat(64) }));

    await expect(view(readerOf(stray))).rejects.toThrow('without its frozen rows');
  });
});

describe('the departed flag (CM-50)', () => {
  const withDeparted = (source: ReturnType<typeof statementSource>) =>
    source.employees.map((label) => ({ ...label, departed: true }));

  it('flags a departed employee in an open month and not otherwise', async () => {
    const stay = (await view(readerOf(ok(true)))) as { employees: { departed: boolean }[] };
    expect(stay.employees.map((employee) => employee.departed)).toEqual([false]);

    const source = statementSource();
    const read = { businessWide: true, branchIds: [SALMIYA], closed: null };
    const left = await view(
      readerOf({ kind: 'ok', read: { ...read, source: { ...source, employees: withDeparted(source) } } }),
    );
    expect((left as { employees: { departed: boolean }[] }).employees.map((e) => e.departed)).toEqual([true]);
  });

  it('flags a departed employee in a closed month from the live source, since frozen rows do not carry it', async () => {
    const closed = closedRead(true, 'APPROVED');
    if (closed.kind !== 'ok') throw new Error('fixture');
    const source = closed.read.source;
    const left = await view(
      readerOf({
        kind: 'ok',
        read: { ...closed.read, source: { ...source, employees: withDeparted(source) } },
      }),
    );
    expect((left as { employees: { departed: boolean }[] }).employees.map((e) => e.departed)).toEqual([true]);
  });
});

describe('refusals', () => {
  it('maps the reader refusals to the uniform codes', async () => {
    await expect(view(readerOf({ kind: 'forbidden' }))).rejects.toBeInstanceOf(
      CommissionPlanVersionError,
    );
    await expect(view(readerOf({ kind: 'forbidden' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(view(readerOf({ kind: 'feature_disabled' }))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
