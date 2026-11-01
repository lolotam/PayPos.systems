import { commissionServiceOverride, type CommissionServiceOverride } from '@pospay/contracts';
import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

const CREATED_AT = `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** أنواع القاعدة المخزّنة في العمود؛ قيد القاعدة في الداتابيز هو اللي يضمنها. */
type OverrideRuleKind = CommissionServiceOverride['rule']['kind'];

type StoredRow = {
  readonly id: string;
  readonly employee_id: string;
  readonly service_id: string;
  readonly rule_kind: OverrideRuleKind;
  readonly rule_pct_bps: number | null;
  readonly rule_fixed_amount: string | null;
  readonly effective_from: string;
  readonly created_at: string;
  readonly created_by: string;
};

function storedRule(row: StoredRow): CommissionServiceOverride['rule'] {
  switch (row.rule_kind) {
    case 'FOLLOW_PLAN':
      return { kind: 'FOLLOW_PLAN' };
    case 'ZERO':
      return { kind: 'ZERO' };
    case 'PCT':
      if (row.rule_pct_bps === null) throw new Error('Invalid override rule');
      return { kind: 'PCT', value: row.rule_pct_bps };
    case 'FIXED':
      if (row.rule_fixed_amount === null) throw new Error('Invalid override rule');
      return { kind: 'FIXED', value: row.rule_fixed_amount };
    default: {
      const unreachable: never = row.rule_kind;
      throw new Error(`Unsupported override rule ${unreachable}`);
    }
  }
}

// القاعدة اتخزنت في عمودين، فكل نوع بيملي عموده والعمود التاني بيفضل null.
function rulePctBps(rule: CommissionServiceOverride['rule']): number | null {
  return rule.kind === 'PCT' ? rule.value : null;
}

function ruleFixedAmount(rule: CommissionServiceOverride['rule']): string | null {
  return rule.kind === 'FIXED' ? rule.value : null;
}

export async function insertCommissionServiceOverride(
  tx: Tx,
  companyId: string,
  businessId: string,
  record: CommissionServiceOverride,
): Promise<CommissionServiceOverride> {
  const [row] = await tx.execute<StoredRow>(sql`INSERT INTO commission_service_overrides(
    company_id,id,business_id,employee_id,service_id,rule_kind,rule_pct_bps,rule_fixed_amount,
    effective_from,created_at,created_by)
    VALUES (${companyId},${record.id},${businessId},${record.employee_id},${record.service_id},
      ${record.rule.kind},${rulePctBps(record.rule)},${ruleFixedAmount(record.rule)},
      ${record.effective_from}::date,${record.created_at}::timestamptz,${record.created_by})
    RETURNING id,employee_id,service_id,rule_kind,rule_pct_bps,
      rule_fixed_amount::text AS rule_fixed_amount,
      to_char(effective_from,'YYYY-MM-DD') AS effective_from,${sql.raw(CREATED_AT)} AS created_at,created_by`);
  if (row === undefined) throw new Error('The commission service override insert returned no row');
  return commissionServiceOverride.parse({
    id: row.id,
    employee_id: row.employee_id,
    service_id: row.service_id,
    rule: storedRule(row),
    effective_from: row.effective_from,
    created_at: row.created_at,
    created_by: row.created_by,
  });
}

export async function auditCommissionServiceOverride(
  tx: Tx,
  ids: IdGenerator,
  record: CommissionServiceOverride,
): Promise<void> {
  await appendAuditLog(tx, ids.newId(), {
    entity: 'commission_service_override',
    entityId: record.id,
    action: 'commission_override.created',
    after: record,
  });
}
