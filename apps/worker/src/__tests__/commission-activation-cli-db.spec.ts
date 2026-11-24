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

it('the new existence query has indexed tenant and revision paths', async () => {
  const plans = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    return tx.execute(
      sql`EXPLAIN (FORMAT JSON) ${sessionTipsAfterBoundStatement(A.company, A.business, '2026-01-01')}`,
    );
  });
  const plan = JSON.stringify(plans);
  expect(plan).toMatch(/service_sessions_(business_day_idx|business_id_key)/);
  expect(plan).toContain('session_tip_revisions_business_session_id_uq');
  expect(plan).not.toContain('Seq Scan');
});

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
    LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 2 $$`;
  try {
    const result = await activationCli('issue', urls(), await issueArgs());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('COVERAGE_VERSION_REFUSED');
    expect(await footprint()).toEqual({ states: 0, proofs: 0, switches: 0 });
  } finally {
    await owner`CREATE OR REPLACE FUNCTION public.commission_coverage_required_version() RETURNS integer
      LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 1 $$`;
  }
});

it('an expired override is shown closed and enable invalidates an already-issued proof', async () => {
  expect((await activationCli('issue', urls(), await issueArgs())).code).toBe(0);
  expect(
    (
      await activationCli('switch', urls(), [
        ...switchArgs(true),
        '--expires',
        '2000-01-01T00:00:00Z',
      ])
    ).code,
  ).toBe(0);
  const show = JSON.parse(
    (await activationCli('switch', urls(), ['--company', A.company, '--show'])).stdout,
  );
  expect(show).toMatchObject({ switch_enabled: false, proof_current: false, generation: '2' });
});
