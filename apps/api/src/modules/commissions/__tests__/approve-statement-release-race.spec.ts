import { COMMISSION_COVERAGE_PROOF_VERSION } from '@pospay/domain';
import type postgres from 'postgres';
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
  holdFreezeGate,
  holdTransaction,
  raceConnections,
  waitForApprovalAtFreeze,
  waitForBlockers,
  type RaceConnections,
} from './approval-race-barriers.fixture.ts';

// ADR-0054 §5 و§8 و§10 اختبار 6: هجرة الإصدار (النسخة الجديدة + رفع الجيل) ضد اعتماد شغّال. الهجرة بتعمل
// الاتنين في معاملة واحدة، والأول فيهم تحديث صف الحالة — فبيستنى قفل الاعتماد FOR SHARE. الترتيب ده مقصود:
// لو الـCREATE OR REPLACE كان الأول لكان بيستنى قفل الكتالوج مش قفل صف الحالة، والاختبار يبقى بيثبت غير اللي
// بنفرضه. (§10 اختبار 6) الاختبار يثبت إن الهجرة بتستنى الاعتماد وإن البوابة بعد التزامها بترفض إثبات النسخة
// القديمة؛ ما فيوش حاجة على صف اتعمل بعد ما بدأت الهجرة — دي التزام deploy (§5) مش قاعدة بيانات.
const TEST_TIMEOUT_MS = 120_000;

let f: StatementFixture;
let approver: Approver;
let connections: RaceConnections;

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'release-race-approver');
  connections = await raceConnections(f.h.urls);
});

afterAll(async () => {
  await connections?.end();
  await f?.h.close();
});

/** شهر REVIEWED بمفتاح اعتماد مفتوح وإثبات ساري بالنسخة المطلوبة، بلا أي أثر اعتماد سابق. */
async function freshMonth(): Promise<{ input: string; statement: string }> {
  await resetStatementToDraft(f);
  await resetCoverage(f);
  const fingerprints = await reviewedStatement(f, approver);
  await openSwitch(f, approver.userId);
  await issueProof(f);
  return fingerprints;
}

/**
 * يرجّع النسخة المطلوبة لقيمة الإثبات الحالي. تغيير في داتابيز الاختبار فقط: هجرة الإصدار بترفع النسخة،
 * والاختبار اللي بعدها محتاج إثبات بالنسخة القديمة يبقى شغّالًا.
 */
async function restoreRequiredVersion(): Promise<void> {
  await connections.owner.unsafe(
    `CREATE OR REPLACE FUNCTION public.commission_coverage_required_version()
      RETURNS integer LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
      AS $$ SELECT ${COMMISSION_COVERAGE_PROOF_VERSION} $$`,
  );
}

/** هجرة الإصدار: النسخة الجديدة ورفع الجيل في معاملة واحدة، بالترتيب اللي يثبت قفل صف الحالة. */
async function releaseMigration(tx: postgres.TransactionSql): Promise<void> {
  await tx`UPDATE commission_coverage_state SET generation = generation + 1,
    bumped_at = pg_catalog.clock_timestamp(), reason = 'RELEASE' WHERE company_id = ${f.company}`;
  await tx.unsafe(
    `CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
      LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
      AS $$ SELECT ${COMMISSION_COVERAGE_PROOF_VERSION + 1} $$`,
  );
}

/** جيل صف الحالة والسبب المحفوظان، والنسخة المطلوبة بعد الهجرة. */
async function releaseState(): Promise<{
  generation: string;
  reason: string;
  version: number;
}> {
  const [state] = await connections.observer<{ generation: string; reason: string }[]>`
    SELECT generation::text AS generation, reason FROM commission_coverage_state
    WHERE company_id = ${f.company}`;
  const [version] = await connections.observer<{ version: number }[]>`
    SELECT public.commission_coverage_required_version()::int AS version`;
  return {
    generation: state?.generation ?? '',
    reason: state?.reason ?? '',
    version: version?.['version'] ?? 0,
  };
}

describe('the release migration racing the approval (ADR-0054 §5 and §8)', () => {
  it('makes the migration wait for the approval share lock, and the month is frozen before the release', async () => {
    const fingerprints = await freshMonth();
    const auditsBefore = (await approvalFootprint(f)).audits;
    const gate = await holdFreezeGate(connections.freeze);
    try {
      const request = approve(f, approver.cookie, 'race-release-approval-first', fingerprints);
      const approvals = await waitForApprovalAtFreeze(
        connections.observer,
        gate.pid,
        'the approval past the coverage gate',
      );
      const migration = await holdTransaction(connections.owner, (tx) => releaseMigration(tx));
      const blockers = await waitForBlockers(
        connections.observer,
        migration.pid,
        'the release migration behind the approval',
      );
      // اللي بيمنع الهجرة هو معاملة الاعتماد نفسها (هي اللي ماسكة القفل FOR SHARE).
      expect(blockers.some((pid) => approvals.includes(pid))).toBe(true);

      gate.release();
      const [response] = await collect([request]);
      expect(response?.status).toBe(200);
      await migration.work;
      migration.release();
      await migration.done;

      // الاعتماد خلص بالقواعد القديمة، THEN الهجرة التزمت: فالكشف معتمد والجيل اتقفل على قيمة جديدة.
      expect(await approvalFootprint(f)).toMatchObject({
        status: 'APPROVED',
        audits: auditsBefore + 1,
      });
      expect(await releaseState()).toMatchObject({
        reason: 'RELEASE',
        version: COMMISSION_COVERAGE_PROOF_VERSION + 1,
      });
    } finally {
      gate.release();
    }
  }, TEST_TIMEOUT_MS);

  it('refuses the approval whose gate starts after the migration commit', async () => {
    // (§10 اختبار 6) البوابة اللي تبدأ بعد التزام الهجرة بترفض إثبات النسخة القديمة.
    await restoreRequiredVersion();
    const fingerprints = await freshMonth();
    const auditsBefore = (await approvalFootprint(f)).audits;
    const migration = await holdTransaction(connections.owner, (tx) => releaseMigration(tx));
    try {
      await migration.work;
      migration.release();
      await migration.done;

      const response = await approve(f, approver.cookie, 'race-release-first', fingerprints);

      expect([response.status, (response.body as { code?: string }).code]).toEqual([
        422,
        'COMMISSION_COVERAGE_NOT_PROVEN',
      ]);      expect(await approvalFootprint(f)).toMatchObject({
        status: 'REVIEWED',
        lines: 0,
        audits: auditsBefore,
      });
    } finally {
      migration.release();
    }
  }, TEST_TIMEOUT_MS);
});
