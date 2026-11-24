import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  resetCoverage,
  resetStatementToDraft,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import { statementFixture, type StatementFixture } from './commission-statement.fixture.ts';
import {
  collect,
  currentGeneration,
  holdFreezeGate,
  holdTransaction,
  issueProofOn,
  raceConnections,
  STATE_ID,
  waitForBlockers,
  waitForGateWaiter,
  waitForStateShareLock,
  type RaceConnections,
} from './approval-race-barriers.fixture.ts';

// ADR-0054 §8 و§10 اختبار 6: الإبطال والإصدار racing الاعتماد. البوابة (الخطوة 5) تمسك صف الحالة FOR SHARE
// لآخر المعاملة، والإبطال والإصدار تمسكانه للكتابة — فالمتكلم الأول يمسكه والتاني ينتظر. الحاجز قفل حقيقي
// (قفل جدول التجميد يوقف الاعتماد بعد البوابة) واستطلاع بميزانية محدودة، بلا نوم ثابت.
const TEST_TIMEOUT_MS = 120_000;

let f: StatementFixture;
let approver: Approver;
let connections: RaceConnections;

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'coverage-race-approver');
  connections = await raceConnections(f.h.urls);
});

afterAll(async () => {
  await connections?.end();
  await f?.h.close();
});

/** شهر REVIEWED بمفتاح اعتماد مفتوح وإثبات ساري، بلا أي أثر اعتماد سابق. */
async function freshMonth(): Promise<{ input: string; statement: string }> {
  await resetStatementToDraft(f);
  await resetCoverage(f);
  const fingerprints = await reviewedStatement(f, approver);
  await openSwitch(f, approver.userId);
  await issueProof(f);
  return fingerprints;
}

/** إبطال حقيقي بدور التطبيق، في معاملة ممسوكة يختار الاختبار وقت الـCOMMIT. */
async function holdInvalidation(): ReturnType<typeof holdTransaction> {
  return holdTransaction(connections.app, async (tx) => {
    await tx`SELECT set_config('app.company_id', ${f.company}, true)`;
    await tx`SELECT public.invalidate_commission_coverage(${STATE_ID}::uuid, 'SOURCE_WRITE')`;
  });
}

/** إصدار حقيقي بدور المرسّل، في معاملة ممسوكة يختار الاختبار وقت الـCOMMIT. */
async function holdIssuance(generation: number): ReturnType<typeof holdTransaction> {
  return holdTransaction(connections.dispatcher, (tx) =>
    issueProofOn(connections.observer, tx, f.company, f.business, generation),
  );
}

/** جيل صف الحالة والسبب المحفوظان. */
async function stateRow(): Promise<{ generation: string; reason: string } | undefined> {
  const [row] = await connections.observer<{ generation: string; reason: string }[]>`
    SELECT generation::text AS generation, reason FROM commission_coverage_state WHERE company_id = ${f.company}`;
  return row;
}

/** أجيال الإثباتات المحفوظة للشركة. */
async function proofGenerations(): Promise<string[]> {
  const rows = await connections.observer<{ generation: string }[]>`
    SELECT generation::text AS generation FROM commission_coverage_proofs
    WHERE company_id = ${f.company} ORDER BY generation`;
  return rows.map((row) => row.generation);
}

describe('the invalidation racing the approval (ADR-0054 §8)', () => {
  it('makes the invalidation wait behind the approval share lock, and freezes the month before the break', async () => {
    const fingerprints = await freshMonth();
    const auditsBefore = (await approvalFootprint(f)).audits;
    const gate = await holdFreezeGate(connections.freeze);
    try {
      const request = approve(f, approver.cookie, 'race-invalidation-approval-first', fingerprints);
      // الاعتماد عدّى البوابة (الخطوة 5) فماسك صف الحالة FOR SHARE، ووقف عند التجميد (الخطوة 8).
      const holders = await waitForStateShareLock(
        connections.observer,
        'the approval share lock on the coverage state row',
      );
      const invalidator = await holdInvalidation();
      const blockers = await waitForBlockers(
        connections.observer,
        invalidator.pid,
        'the invalidation behind the approval',
      );
      // اللي بيمنع الإبطال هو معاملة الاعتماد نفسها (هي اللي ماسكة القفل FOR SHARE).
      expect(blockers.some((pid) => holders.includes(pid))).toBe(true);

      gate.release();
      const [response] = await collect([request]);
      expect(response?.status).toBe(200);
      await invalidator.work;
      invalidator.release();
      await invalidator.done;

      const footprint = await approvalFootprint(f);
      expect(footprint).toMatchObject({ status: 'APPROVED', audits: auditsBefore + 1 });
      expect(footprint.lines).toBeGreaterThan(0);
      // الإبطال التزم بعد الاعتماد: الجيل اتقفل على القيمة الجديدة والسبب مسجّل.
      expect(await stateRow()).toMatchObject({ reason: 'SOURCE_WRITE' });
    } finally {
      gate.release();
    }
  }, TEST_TIMEOUT_MS);

  it('makes the approval wait behind the invalidation and then refuse the proof it no longer has', async () => {
    const fingerprints = await freshMonth();
    const auditsBefore = (await approvalFootprint(f)).audits;
    const invalidator = await holdInvalidation();
    try {
      await invalidator.work;
      const request = approve(f, approver.cookie, 'race-invalidation-first', fingerprints);
      // الاعتماد واقف على البوابة: قفل FOR SHARE بيستنى الإبطال اللي ماسك الصف للكتابة.
      await waitForGateWaiter(connections.observer, invalidator.pid, 'the approval at the gate');

      invalidator.release();
      await invalidator.done;
      const [response] = await collect([request]);

      expect([response?.status, (response?.body as { code?: string }).code]).toEqual([
        422,
        'COMMISSION_COVERAGE_NOT_PROVEN',
      ]);
      expect(await approvalFootprint(f)).toMatchObject({
        status: 'REVIEWED',
        lines: 0,
        audits: auditsBefore,
      });
    } finally {
      invalidator.release();
    }
  }, TEST_TIMEOUT_MS);
});

describe('the issuance racing the approval (ADR-0054 §8)', () => {
  it('makes the issuance wait behind the approval share lock, and leaves exactly one current proof', async () => {
    const fingerprints = await freshMonth();
    const generation = await currentGeneration(connections.observer, f.company);
    const gate = await holdFreezeGate(connections.freeze);
    try {
      const request = approve(f, approver.cookie, 'race-issuance-approval-first', fingerprints);
      const holders = await waitForStateShareLock(
        connections.observer,
        'the approval share lock on the coverage state row',
      );
      const issuer = await holdIssuance(generation);
      const blockers = await waitForBlockers(
        connections.observer,
        issuer.pid,
        'the issuance behind the approval',
      );
      expect(blockers.some((pid) => holders.includes(pid))).toBe(true);

      gate.release();
      const [response] = await collect([request]);
      expect(response?.status).toBe(200);
      const issued = (await issuer.work) as number;
      issuer.release();
      await issuer.done;

      // الاعتماد اشوف الإثبات القديم كاملًا؛ الإصدار التزم بعده فما فيش إلا إثبات واحد ساري.
      expect(issued).toBe(generation + 1);
      expect(await proofGenerations()).toEqual([String(generation), String(generation + 1)]);
      expect(await stateRow()).toMatchObject({ generation: String(generation + 1) });
    } finally {
      gate.release();
    }
  }, TEST_TIMEOUT_MS);

  it('makes the approval wait behind the issuance and then read the new current proof', async () => {
    const fingerprints = await freshMonth();
    const generation = await currentGeneration(connections.observer, f.company);
    const issuer = await holdIssuance(generation);
    try {
      await issuer.work;
      const request = approve(f, approver.cookie, 'race-issuance-first', fingerprints);
      await waitForGateWaiter(
        connections.observer,
        issuer.pid,
        'the approval at the coverage gate',
      );

      issuer.release();
      await issuer.done;
      const [response] = await collect([request]);

      expect(response?.status).toBe(200);
      expect(await proofGenerations()).toEqual([String(generation), String(generation + 1)]);
      expect(await stateRow()).toMatchObject({ generation: String(generation + 1) });
    } finally {
      issuer.release();
    }
  }, TEST_TIMEOUT_MS);
});
