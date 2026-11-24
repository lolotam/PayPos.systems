import { COMMISSION_COVERAGE_PROOF_VERSION } from '@pospay/domain';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  generateStatement,
  memberWithGrants,
  PERIOD,
  READ,
  statementPath,
  type StatementFixture,
} from './commission-statement.fixture.ts';

export const APPROVE = 'approve:commissions:business';
export const SWITCH_FLAG = 'commission_statement_approval';

// مفتاح إعادة إرسال جديد لكل توليد، لأن إعادة استعمال المفتاح بنفس الطلب ترجّع الرد المخزّن القديم لا الحساب الحالي.
let generateKey = 0;

export interface Approver {
  readonly cookie: string;
  readonly userId: string;
  readonly membershipId: string;
}

/**
 * مستخدم بصلاحية الاعتماد الحقيقية `approve:commissions:business` مع قراءة النشاط كله، بدور مخصص وعضوية على نطاق النشاط.
 *
 * @param f نشاط الاختبار
 * @param label اسم قصير يميّز المستخدم
 * @returns الجلسة والمستخدم والعضوية
 */
export async function approverMember(f: StatementFixture, label: string): Promise<Approver> {
  const member = await memberWithGrants(f, label, [
    { permission: APPROVE, scope: 'BUSINESS' },
    { permission: READ, scope: 'BUSINESS' },
  ]);
  return { cookie: member.cookie, userId: member.userId, membershipId: member.membershipIds[0] ?? '' };
}

/** يولّد كشف الشهر بصاحب الشركة ثم يضعه REVIEWED ببصمتيه الحاليتين، ويرجّع البصمتين. */
export async function reviewedStatement(
  f: StatementFixture,
  reviewer: Approver,
  period = PERIOD,
): Promise<{ input: string; statement: string }> {
  generateKey += 1;
  const response = await generateStatement(
    f,
    f.cookie,
    `generate-${period}-${reviewer.userId}-${generateKey}`,
    period,
  );
  const body = response.body as { current_fingerprint: string; current_statement_fingerprint: string };
  await f.h.owner`UPDATE commission_statements SET status = 'REVIEWED',
      reviewed_fingerprint = ${body.current_fingerprint},
      reviewed_statement_fingerprint = ${body.current_statement_fingerprint},
      reviewed_by = ${reviewer.userId}, reviewed_membership_id = ${reviewer.membershipId}, reviewed_at = now()
    WHERE company_id = ${f.company} AND business_id = ${f.business} AND period = ${period}`;
  return { input: body.current_fingerprint, statement: body.current_statement_fingerprint };
}

/** يفتح مفتاح الاعتماد الصريح للشركة، كما يفعل أمر المشغّل في PR B. */
export async function openSwitch(f: StatementFixture, userId: string): Promise<void> {
  await f.h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
    VALUES (${f.company}, ${SWITCH_FLAG}, true, 'approval fixture', ${userId})
    ON CONFLICT (company_id, flag) DO UPDATE SET enabled = true, expires_at = NULL`;
}

/** يصدر إثباتًا يغطي كل أنشطة الشركة بدور المالك (الدالة مؤهلة للمالك superuser)، بحد بقشيش يغطي أي شهر. */
export async function issueProof(f: StatementFixture): Promise<void> {
  const stateId = '01980000-0000-7000-8000-0000000000e1';
  const [state] = await f.h.owner`SELECT out_generation::text AS generation
    FROM public.current_commission_coverage_generation(${f.company}::uuid, ${stateId}::uuid)`;
  const [identity] = await f.h.owner`SELECT current_database()::text AS name,
    public.pospay_system_id()::text AS system_id,
    ((now() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  await f.h.owner`SELECT public.issue_commission_coverage_proof(
    ${f.company}::uuid, ${'01980000-0000-7000-8000-0000000000e2'}::uuid, ${state?.['generation'] as string}::bigint,
    ${COMMISSION_COVERAGE_PROOF_VERSION}::integer, ARRAY[${f.business}]::uuid[], '2026-01-01'::date,
    ${identity?.['bound'] as string}::date, ${identity?.['bound'] as string}::date, NULL::uuid,
    ${identity?.['name'] as string}::text, ${identity?.['system_id'] as string}::bigint, 'approval-fixture', 'test')`;
}

/** الاعتماد بمفتاح إعادة إرسال وبصمتين متوقعتين. */
export const approve = (
  f: StatementFixture,
  cookie: string,
  key: string,
  fingerprints: { input: string; statement: string },
  period = PERIOD,
) =>
  f.h.send('POST', statementPath(f.business, period, '/approve'), {
    cookie,
    company: f.company,
    key,
    body: {
      expected_fingerprint: fingerprints.input,
      expected_statement_fingerprint: fingerprints.statement,
    },
  });

/** حالة الكشف وعدد صفوفه المجمّدة وتدقيق الاعتماد، علشان إثبات «ما اتجمّد شيء». */
export async function approvalFootprint(
  f: StatementFixture,
  period = PERIOD,
): Promise<{ status: string; lines: number; audits: number; carries: number }> {
  const [row] = await f.h.owner`SELECT s.status,
      (SELECT count(*)::int FROM commission_statement_lines l WHERE l.statement_id = s.id) AS lines,
      (SELECT count(*)::int FROM audit_log WHERE entity_id = s.id AND action = 'commission_statement.approved') AS audits,
      (SELECT count(*)::int FROM commission_carries c WHERE c.source_statement_id = s.id) AS carries
    FROM commission_statements s
    WHERE s.company_id = ${f.company} AND s.business_id = ${f.business} AND s.period = ${period}`;
  return row as { status: string; lines: number; audits: number; carries: number };
}

/** يعيد شهر الاختبار إلى DRAFT بلا صفوف مجمّدة ولا مرحّلات (وضع replica للمالك فقط، فالتريغرات تمنع ذلك على الإنتاج). */
export async function resetStatementToDraft(f: StatementFixture, period = PERIOD): Promise<void> {
  await asReplicaOwner(f.h.owner, async (tx) => {
    await tx`DELETE FROM commission_carries WHERE company_id = ${f.company}`;
    await tx`DELETE FROM commission_statement_lines WHERE company_id = ${f.company}`;
    await tx`DELETE FROM commission_statement_attachments WHERE company_id = ${f.company}`;
    await tx`UPDATE commission_statements SET status = 'DRAFT', reviewed_fingerprint = NULL,
        reviewed_statement_fingerprint = NULL, reviewed_by = NULL, reviewed_membership_id = NULL,
        reviewed_at = NULL, input_fingerprint = NULL, statement_fingerprint = NULL, approved_by = NULL,
        approved_at = NULL, approval_xact_id = NULL
      WHERE company_id = ${f.company} AND business_id = ${f.business} AND period = ${period}`;
  });
}

/** يمسح الإثبات وحالة التغطية ومفتاح الاعتماد للشركة ليبدأ الاختبار من إغلاق كامل (وضع replica للمالك فقط). */
export async function resetCoverage(f: StatementFixture): Promise<void> {
  await f.h.owner`DELETE FROM company_feature_overrides
    WHERE company_id = ${f.company} AND flag = ${SWITCH_FLAG}`;
  await asReplicaOwner(f.h.owner, async (tx) => {
    await tx`DELETE FROM commission_coverage_proofs WHERE company_id = ${f.company}`;
    await tx`DELETE FROM commission_coverage_state WHERE company_id = ${f.company}`;
  });
}

/** يراجع الشهر ويفتح المفتاح ويصدر الإثبات ثم يعتمد بمفتاح إعادة إرسال؛ يرجّع رد الاعتماد وبصمتي المراجعة. */
export async function approveReviewedMonth(
  f: StatementFixture,
  approver: Approver,
  key: string,
  period = PERIOD,
) {
  const fingerprints = await reviewedStatement(f, approver, period);
  await openSwitch(f, approver.userId);
  await issueProof(f);
  return { response: await approve(f, approver.cookie, key, fingerprints, period), fingerprints };
}
