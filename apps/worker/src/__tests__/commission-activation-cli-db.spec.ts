import { createCoverageIssuer } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';

import { activationCli } from '../../../../packages/db/test/commission-activation-cli.ts';
import { asReplicaOwner } from '../../../../packages/db/test/owner-cleanup.ts';
import {
  A,
  B,
  CUSTOMER_A,
  CUSTOMER_B,
  db,
  eventId,
  owner,
  seedSession,
  testDb,
  tip,
  useBootstrapHarness,
  writeTipRevision,
} from '../modules/commissions/__tests__/bootstrap-session-tips-db.harness.ts';
import {
  createSessionTipsAfterBoundReader,
  sessionTipsAfterBoundStatement,
} from '../modules/orders/queries/session-tips-after-bound.reader.ts';
import { businessTimeZone } from '../modules/tenancy/index.ts';

const readSessionTipsAfterBound = createSessionTipsAfterBoundReader({
  isKnown: async (tx, companyId, businessId) =>
    (await businessTimeZone(tx, companyId, businessId)) !== null,
});

useBootstrapHarness();

beforeEach(async () => {
  await owner`DELETE FROM company_feature_overrides WHERE flag = 'commission_statement_approval'`;
  await owner`DELETE FROM platform_audit_log WHERE action LIKE 'commissions.%'`;
  await asReplicaOwner(owner, async (tx) => {
    await tx`DELETE FROM commission_coverage_proofs`;
    await tx`DELETE FROM commission_coverage_state`;
  });
});

const urls = () => ({
  owner: testDb.ownerUrl,
  app: testDb.appUrl,
  dispatcher: testDb.dispatcherUrl,
});
const unknown = '01980000-0000-7000-8000-0000000000ff';
const switchArgs = (enabled: boolean, company: string = A.company) => [
  '--company',
  company,
  enabled ? '--enable' : '--disable',
  '--reason',
  'synthetic activation',
  '--operator-email',
  'commission-operator@example.test',
];

async function issueArgs(company: string = A.company, business?: string) {
  const [clock] =
    await owner`SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  const businesses =
    await owner`SELECT id FROM businesses WHERE company_id = ${company} ORDER BY id`;
  return [
    '--company',
    company,
    '--businesses',
    business ?? (businesses.map((row) => String(row['id'])).join(',') || A.business),
    '--from',
    '0001-01-01',
    '--to',
    String(clock?.['bound']),
    '--run-id',
    'synthetic-run',
    '--release',
    'test',
  ];
}

async function footprint(company: string = A.company) {
  const [row] = await owner`SELECT
    (SELECT count(*)::int FROM commission_coverage_state WHERE company_id = ${company}) AS states,
    (SELECT count(*)::int FROM commission_coverage_proofs WHERE company_id = ${company}) AS proofs,
    (SELECT count(*)::int FROM company_feature_overrides WHERE company_id = ${company}
      AND flag = 'commission_statement_approval') AS switches`;
  return row;
}

it('enable, dry-run, issue, re-run and disable are audited and leave the other tenant untouched', async () => {
  expect((await activationCli('switch', urls(), switchArgs(true))).code).toBe(0);
  const show = await activationCli('switch', urls(), ['--company', A.company, '--show']);
  expect(JSON.parse(show.stdout)).toMatchObject({
    switch_enabled: true,
    proof_current: false,
    status: 'SWITCH_ON_NO_CURRENT_PROOF',
  });
  const args = await issueArgs();
  expect((await activationCli('issue', urls(), [...args, '--dry-run'])).code).toBe(0);
  expect(await footprint()).toMatchObject({ states: 1, proofs: 0, switches: 1 });
  const issued = await activationCli('issue', urls(), args);
  expect(issued).toMatchObject({ code: 0 });
  expect(JSON.parse(issued.stdout)).toMatchObject({
    generation: '2',
    result: { status: 'ISSUED', version: 1 },
  });
  expect((await activationCli('issue', urls(), args)).code).toBe(0);
  expect(await footprint()).toMatchObject({ proofs: 2 });
  expect(
    JSON.parse((await activationCli('switch', urls(), ['--company', A.company, '--show'])).stdout),
  ).toMatchObject({ proof_current: true, generation: '3' });
  expect((await activationCli('switch', urls(), switchArgs(false))).code).toBe(0);
  expect(
    JSON.parse((await activationCli('switch', urls(), ['--company', A.company, '--show'])).stdout),
  ).toMatchObject({ switch_enabled: false, proof_current: false, generation: '4' });
  const rows =
    await owner`SELECT actor, action, target_user_id, details FROM platform_audit_log WHERE action LIKE 'commissions.%' ORDER BY at,id`;
  const [operator] =
    await owner`SELECT id FROM "user" WHERE email = 'commission-operator@example.test'`;
  expect(rows.map((row) => row['action'])).toEqual([
    'commissions.approval_enabled',
    'commissions.approval_disabled',
  ]);
  for (const row of rows)
    expect(row).toMatchObject({
      actor: `user:${operator?.['id']}`,
      target_user_id: null,
      details: {
        company_id: A.company,
        reason: 'synthetic activation',
        operator_user_id: operator?.['id'],
      },
    });
  expect(JSON.stringify(rows)).not.toContain('@');
  expect(await footprint(B.company)).toEqual({ states: 0, proofs: 0, switches: 0 });
}, 90_000);

it('dry-run on a never-ensured company leaves no state or proof', async () => {
  expect((await activationCli('issue', urls(), [...(await issueArgs()), '--dry-run'])).code).toBe(
    0,
  );
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
});

it.each(['switch', 'issue'] as const)(
  'unknown company cannot drive %s or leave rows',
  async (command) => {
    const args = command === 'switch' ? switchArgs(true, unknown) : await issueArgs(unknown);
    const result = await activationCli(command, urls(), args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('COVERAGE_COMPANY_NOT_FOUND');
    expect(await footprint(unknown)).toEqual({ states: 0, proofs: 0, switches: 0 });
  },
);

it('unknown operator refuses before changing state, switch or audit', async () => {
  const args = switchArgs(true);
  args[args.length - 1] = 'absent@example.test';
  const result = await activationCli('switch', urls(), args);
  expect(result).toMatchObject({ code: 1 });
  expect(result.stderr).toContain('COVERAGE_OPERATOR_NOT_FOUND');
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  expect(
    await owner`SELECT id FROM platform_audit_log WHERE action LIKE 'commissions.%'`,
  ).toHaveLength(0);
});

it('an operator without an active platform grant is refused before any write', async () => {
  // second-reviewer@example.test موجود بلا منحة منصة؛ الرفض بنفس شرح جلسات المنصة وقبل أي كتابة.
  const args = switchArgs(true);
  args[args.length - 1] = 'second-reviewer@example.test';
  const result = await activationCli('switch', urls(), args);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('COVERAGE_OPERATOR_NOT_PLATFORM');
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  expect(
    await owner`SELECT id FROM platform_audit_log WHERE action LIKE 'commissions.%'`,
  ).toHaveLength(0);
});

it('operator email matching is the shared userIdOf lookup: email = lower(input), never two users', async () => {
  const mixed = switchArgs(true);
  mixed[mixed.length - 1] = 'Commission-Operator@Example.test';
  expect((await activationCli('switch', urls(), mixed)).code).toBe(0);
  await owner`INSERT INTO "user"(id,name,email)
    VALUES('01920000-0000-7000-8000-000000000cf1','Case twin','Commission-Operator@Example.test')`;
  try {
    // المطابقة الموحّدة مع platform:grant هي email = lower(المُدخل): التوأم المختلف بالحالة لا
    // يطابق البريد المُصغَّر، فيبقى الحل دائماً للمستخدم الأصلي وحده — لا مسار غموض إطلاقاً.
    const lowered = switchArgs(true);
    lowered[lowered.length - 1] = 'commission-operator@EXAMPLE.test';
    expect((await activationCli('switch', urls(), lowered)).code).toBe(0);
    // خطاب التوأم بإيميله الحرفي يُصغَّر هو الآخر، فيحلّ إلى المستخدم الأصلي المخزَّن بأحرف صغيرة
    // ويُفعّل من جديد: بريد مخزَّن بأحرف مختلطة لا يمكن لأي مُدخل أن يصل إليه، بلا غموض.
    const twin = switchArgs(true);
    twin[twin.length - 1] = 'Commission-Operator@Example.test';
    expect((await activationCli('switch', urls(), twin)).code).toBe(0);
    expect(await footprint()).toEqual({ states: 1, proofs: 0, switches: 1 });
    // ثلاثة تمكينات ناجحة (مختلط الحالة، مُصغَّر، وإيميل التوأم المختلط بعد تصغيره) — كل واحد
    // سطر تدقيق واحد على المستخدم الأصلي، والمفتاح صف واحد مُحدَّث.
    expect(
      (
        await owner`SELECT id FROM platform_audit_log WHERE action LIKE 'commissions.%'
          AND details->>'reason' = 'synthetic activation' ORDER BY at`
      ).map((row) => String(row['id'])),
    ).toHaveLength(3);
    // المستخدم الحلَّه الأمران: user:<id> في سطر التدقيق الوحيد هو معرّف المشغّل الأصلي المخزَّن.
    const [operator] =
      await owner`SELECT id FROM "user" WHERE email = 'commission-operator@example.test'`;
    const [audit] = await owner`SELECT actor FROM platform_audit_log
      WHERE action LIKE 'commissions.%' AND details->>'reason' = 'synthetic activation'`;
    expect(String(audit?.['actor'])).toBe(`user:${String(operator?.['id'])}`);
  } finally {
    await owner`DELETE FROM "user" WHERE id = '01920000-0000-7000-8000-000000000cf1'`;
  }
});

it.each([
  ['2030-01-01', 'date-only'],
  ['2030-01-01T00:00:00', 'no offset'],
  ['2030-02-31T00:00:00Z', 'rolled day'],
  ['2030-01-01T25:00:00Z', 'rolled hour'],
  ['2030-01-01T00:00:00+15:00', 'offset beyond ±14:00'],
])('expiry %s (%s) is usage-refused before the database is touched', async (expires) => {
  const result = await activationCli('switch', urls(), [...switchArgs(true), '--expires', expires]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('COVERAGE_OPERATOR_INPUT_INVALID');
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  expect(
    await owner`SELECT id FROM platform_audit_log WHERE action LIKE 'commissions.%'`,
  ).toHaveLength(0);
});

it('a past expiry is refused against the database clock after the lock, before the bump', async () => {
  const result = await activationCli('switch', urls(), [
    ...switchArgs(true),
    '--expires',
    '2000-01-01T00:00:00Z',
  ]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('COVERAGE_EXPIRY_IN_PAST');
  // الرفض داخل المعاملة بعد القفل: حتى صف ensure يُتراجع، فلا حالة ولا مفتاح ولا سطر تدقيق.
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  expect(
    await owner`SELECT id FROM platform_audit_log WHERE action LIKE 'commissions.%'`,
  ).toHaveLength(0);
});

it('foreign scope is refused, and an uncovered tip revision never gets a proof', async () => {
  expect((await activationCli('issue', urls(), await issueArgs(A.company, B.business))).code).toBe(
    1,
  );
  const args = await issueArgs();
  const { ctx, sessionId } = await seedSession(A, '2026-01-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(301), [tip(A.employee, 'CASH', '1.000')]);
  const result = await activationCli('issue', urls(), args);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('COVERAGE_REPORT_NOT_COVERED');
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
});

it('Orders detects dates beyond 9999, includes every revision and isolates tenants', async () => {
  const { ctx, sessionId } = await seedSession(A, '9999-12-31', CUSTOMER_A);
  // قيمة SQL حرفية: محوّل date في العميل يمر عبر ساعة JavaScript ويغيّر اليوم للتاريخ ذي الخمس خانات.
  await asReplicaOwner(
    owner,
    (tx) =>
      tx`UPDATE service_sessions SET business_date = DATE '10000-01-01' WHERE id = ${sessionId}`,
  );
  await writeTipRevision(ctx, sessionId, 1, eventId(302), [tip(A.employee, 'CASH', '1.000')]);
  const [stored] =
    await owner`SELECT business_date::text AS day, business_date > '9999-12-31'::date AS beyond,
    (SELECT count(*)::int FROM session_tip_revisions WHERE session_id = ${sessionId}) AS revisions
    FROM service_sessions WHERE id = ${sessionId}`;
  expect(stored).toEqual({ day: '10000-01-01', beyond: true, revisions: 1 });
  expect(
    await db.withTenant(A.company, (tx) =>
      readSessionTipsAfterBound(tx, A.company, A.business, '9999-12-31'),
    ),
  ).toBe(true);
  expect(
    await db.withTenant(B.company, (tx) =>
      readSessionTipsAfterBound(tx, B.company, B.business, '2026-01-01'),
    ),
  ).toBe(false);
  await expect(
    db.withTenant(B.company, (tx) =>
      readSessionTipsAfterBound(tx, A.company, A.business, '2026-01-01'),
    ),
  ).rejects.toThrow('COVERAGE_TENANT_MISMATCH');
  await expect(
    db.withTenant(A.company, (tx) =>
      readSessionTipsAfterBound(tx, A.company, unknown, '2026-01-01'),
    ),
  ).rejects.toThrow('COVERAGE_SCOPE_INCOMPLETE');
  const refusal = await activationCli('issue', urls(), await issueArgs());
  expect(refusal.stderr).toContain('COVERAGE_TIPS_AFTER_BOUND');
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
});

it('Orders allows a revision exactly at U and rejects one strictly after U', async () => {
  const { ctx, sessionId } = await seedSession(A, '2026-11-25', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(303), [tip(A.employee, 'CARD', '1.000')]);
  const other = await seedSession(B, '2027-01-01', CUSTOMER_B);
  await writeTipRevision(other.ctx, other.sessionId, 1, eventId(304), [
    tip(B.employee, 'CARD', '1.000'),
  ]);
  expect(
    await db.withTenant(A.company, (tx) =>
      readSessionTipsAfterBound(tx, A.company, A.business, '2026-11-25'),
    ),
  ).toBe(false);
  expect(
    await db.withTenant(A.company, (tx) =>
      readSessionTipsAfterBound(tx, A.company, A.business, '2026-11-24'),
    ),
  ).toBe(true);
});

it('the existence query plan uses the tenant, business and date index on a seeded history', async () => {
  // تاريخ واقعي الحجم بدون تعطيل seqscan: 20 ألف جلسة منسوخة من جلسة الحاضنة بأيام قبل الحد،
  // وإحصاء الجدول يُحدَّث هنا كي يختار المخطط من إحصاءات صحيحة لا من جدول فارغ.
  const { sessionId } = await seedSession(A, '2025-06-01', CUSTOMER_A);
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,
      customer_phone_masked,recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,
      business_timezone,late)
    SELECT company_id, gen_random_uuid(), business_id, branch_id, customer_id, customer_name,
      customer_phone_masked, recorded_by, recorded_by_membership_id, occurred_at, recorded_at,
      DATE '2025-01-01' + (g % 330), business_timezone, false
    FROM service_sessions, generate_series(1, 20000) g WHERE id = ${sessionId}`;
  await owner`ANALYZE service_sessions`;
  const plans = await db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sessionTipsAfterBoundStatement(A.company, A.business, '2026-01-01')}`,
    ),
  );
  const plan = JSON.stringify(plans);
  // المسح على فهرس الشركة والنشاط والتاريخ، وشرط الفهرس يحمل مسند business_date نفسه، لا مسح كامل.
  expect(plan).toContain('service_sessions_business_day_idx');
  expect(plan).toContain('business_date');
  expect(plan).toContain('session_tip_revisions_business_session_id_uq');
  expect(plan).not.toContain('Seq Scan');
}, 60_000);

it('app credentials cannot drive the dispatcher issuance facade', async () => {
  const issuer = createCoverageIssuer(testDb.appUrl);
  try {
    await expect(
      issuer.verifyAndIssue(A.company, unknown, async () => ({ result: null, proof: null })),
    ).rejects.toThrow('COVERAGE_DISPATCHER_REQUIRED');
  } finally {
    await issuer.close();
  }
  expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
});

it('a different installed rules version refuses the real command without an ensure row', async () => {
  // التغيير في نسخة ملف الاختبار فقط ويُعاد في finally؛ لا هجرة ولا تغيير على cluster مشترك.
  await owner`CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
    LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 2 $$`;
  try {
    const result = await activationCli('issue', urls(), await issueArgs());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('COVERAGE_VERSION_REFUSED');
    expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  } finally {
    await owner`CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
      LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$`;
  }
});

it('an expired override is shown closed and enable invalidates an already-issued proof', async () => {
  expect((await activationCli('issue', urls(), await issueArgs())).code).toBe(0);
  // الأمر يأخذ انتهاءً مستقبلياً بساعة قاعدة البيانات فقط؛ التقادم يُحاكى بتحديث المفتاح مباشرة.
  const [future] = await owner`SELECT to_char((clock_timestamp() + interval '1 hour') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso`;
  expect(
    (
      await activationCli('switch', urls(), [
        ...switchArgs(true),
        '--expires',
        String(future?.['iso']),
      ])
    ).code,
  ).toBe(0);
  await owner`UPDATE company_feature_overrides SET expires_at = clock_timestamp() - interval '1 minute'
    WHERE flag = 'commission_statement_approval'`;
  const show = JSON.parse(
    (await activationCli('switch', urls(), ['--company', A.company, '--show'])).stdout,
  );
  expect(show).toMatchObject({ switch_enabled: false, proof_current: false, generation: '2' });
});
