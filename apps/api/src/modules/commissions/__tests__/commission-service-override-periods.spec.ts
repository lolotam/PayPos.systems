import { afterEach, beforeEach, expect, it } from 'vitest';

import { CreateCommissionServiceOverrideUseCase } from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import {
  closeCommissionFixture,
  ids,
  memberWithoutPlanPermission,
  setCommissionStatement,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  idempotencyClaims,
  overrideAndAuditCounts,
  overrideCommand,
  overrideInput,
  overrideTransactionsWithAccess,
  OVERRIDE_NOW,
  runOverride,
  writeOverride,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

async function statementRows(fixture: CommissionServiceOverrideFixture): Promise<
  { readonly period: string; readonly status: string }[]
> {
  return fixture.h.owner`SELECT period,status FROM commission_statements
    WHERE company_id=${fixture.company} AND business_id=${fixture.business} ORDER BY period`;
}

it('CM-13 an ordinary effective date before the business today is refused and writes nothing', async () => {
  const before = await overrideAndAuditCounts(f);
  const statements = await statementRows(f);
  await expect(
    writeOverride(f, overrideInput(f, { effective_from: '2026-10-29' }), 'cm-13-yesterday'),
  ).rejects.toMatchObject({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await statementRows(f)).toEqual(statements);
});

it('CM-13 a year-one date is refused without locking or creating any statement', async () => {
  const before = await overrideAndAuditCounts(f);
  const statements = await statementRows(f);
  await expect(
    writeOverride(f, overrideInput(f, { effective_from: '0001-01-01' }), 'cm-13-year-one'),
  ).rejects.toMatchObject({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await statementRows(f)).toEqual(statements);
});

it('CM-13 a future effective date saves without creating a statement for the future month', async () => {
  const created = await writeOverride(
    f,
    overrideInput(f, { effective_from: '2026-11-15' }),
    'cm-13-future',
  );
  expect(created.effective_from).toBe('2026-11-15');
  expect(await statementRows(f)).toEqual([]);
  expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
});

it.each(['APPROVED', 'PAID'] as const)(
  'CM-13 a %s month refuses the override and writes nothing',
  async (status) => {
    await setCommissionStatement(f, '2026-10', status);
    const before = await overrideAndAuditCounts(f);
    await expect(
      writeOverride(f, overrideInput(f), 'cm-13-closed'),
    ).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });
    expect(await overrideAndAuditCounts(f)).toEqual(before);
  },
);

it('CM-13 a REVIEWED month reopens to DRAFT and clears every review evidence', async () => {
  await setCommissionStatement(f, '2026-10', 'REVIEWED');
  const created = await writeOverride(f, overrideInput(f), 'cm-13-reopen');
  expect(created.id).toBeTruthy();
  const statements = await f.h.owner`SELECT period,status,reviewed_fingerprint,
    reviewed_statement_fingerprint,reviewed_by,reviewed_membership_id,reviewed_at
    FROM commission_statements WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(statements).toEqual([
    expect.objectContaining({
      period: '2026-10',
      status: 'DRAFT',
      reviewed_fingerprint: null,
      reviewed_statement_fingerprint: null,
      reviewed_by: null,
      reviewed_membership_id: null,
      reviewed_at: null,
    }),
  ]);
});

it('CM-13 a forced audit failure rolls the reopen, the row and the idempotency claim back', async () => {
  await setCommissionStatement(f, '2026-10', 'REVIEWED');
  const reviewEvidence = () => f.h.owner`SELECT status,reviewed_fingerprint,
    reviewed_statement_fingerprint,reviewed_by,reviewed_membership_id,reviewed_at
    FROM commission_statements WHERE company_id=${f.company} AND business_id=${f.business}
      AND period='2026-10'`;
  const beforeReview = await reviewEvidence();
  await f.h.owner`CREATE OR REPLACE FUNCTION reject_override_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'commission_override.created' THEN
        RAISE EXCEPTION 'forced audit failure';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`;
  await f.h.owner`CREATE TRIGGER force_override_audit_failure BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_override_audit()`;
  try {
    await expect(
      runOverride(f, overrideInput(f), 'cm-13-audit-failure'),
    ).rejects.toMatchObject({ cause: { code: 'P0001', message: 'forced audit failure' } });
    expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
    expect(await idempotencyClaims(f)).toBe(0);
    const statements = await reviewEvidence();
    // الشهر رجع REVIEWED زي ما كان: إعادة الفتح اتعملت في نفس المعاملة اللي فشلت.
    expect(statements).toEqual(beforeReview);
  } finally {
    await f.h.owner`DROP TRIGGER IF EXISTS force_override_audit_failure ON audit_log`;
    await f.h.owner`DROP FUNCTION IF EXISTS reject_override_audit()`;
  }
});

it('a member without the commission permission is refused before any write', async () => {
  const member = await memberWithoutPlanPermission(f);
  const before = await overrideAndAuditCounts(f);
  const claims = await idempotencyClaims(f);
  await expect(
    runOverride(f, overrideInput(f), 'cm-13-no-permission', { userId: member.userId }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await idempotencyClaims(f)).toBe(claims);
  expect(await statementRows(f)).toEqual([]);
});

it('the commissions feature turned off refuses the write with FEATURE_DISABLED and stores nothing', async () => {
  const before = await overrideAndAuditCounts(f);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'Synthetic disabled',${f.userId})`;
  try {
    await expect(
      runOverride(f, overrideInput(f), 'cm-13-feature-disabled'),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(await overrideAndAuditCounts(f)).toEqual(before);
    expect(await idempotencyClaims(f)).toBe(0);
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides
      WHERE company_id=${f.company} AND flag='commissions'`;
  }
});

it('a boundary-controlled access decision on the final recheck rolls the reopen, the row and the claim back', async () => {
  await setCommissionStatement(f, '2026-10', 'REVIEWED');
  const before = await overrideAndAuditCounts(f);
  let calls = 0;
  // القرار الأول يسمح، والتاني بعد الأقفال يرفض: ده هو إعادة الفحص الأخيرة جوه نفس المعاملة.
  const access = async () => {
    calls += 1;
    return calls === 1 ? null : ('FORBIDDEN' as const);
  };
  const useCase = new CreateCommissionServiceOverrideUseCase(
    overrideTransactionsWithAccess(f, access),
    ids,
    { now: () => OVERRIDE_NOW },
  );
  await expect(
    useCase.execute(overrideCommand(f, overrideInput(f), 'cm-13-final-recheck')),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(calls).toBe(2);
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await idempotencyClaims(f)).toBe(0);
  const statements = await f.h.owner`SELECT status,reviewed_by,reviewed_at FROM commission_statements
    WHERE company_id=${f.company} AND business_id=${f.business} AND period='2026-10'`;
  // الشهر رجع REVIEWED: إعادة الفتح اللي قبل الرفض اتعملت في نفس المعاملة اللي اترمت.
  expect(statements).toEqual([
    expect.objectContaining({ status: 'REVIEWED', reviewed_by: expect.anything() }),
  ]);
});
