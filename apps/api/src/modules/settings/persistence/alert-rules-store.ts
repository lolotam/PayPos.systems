import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { AlertKind, AlertRuleSettings } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { lockAlertRulesAccess } from '../../identity/index.ts';
import type {
  AlertRulesScope,
  AlertRulesSnapshot,
  AlertRulesTransactions,
  AlertRuleTarget,
  StoredAlertRule,
} from '../ports/alert-rules.port.ts';

type Row = {
  kind: AlertKind;
  enabled: boolean;
  recipient_roles: AlertRuleSettings['recipientRoles'];
  channels: AlertRuleSettings['channels'];
  delay_minutes: number | null;
  lead_minutes: number | null;
  revision: number;
};

type ScopedRow = Row & { branch_id: string | null };

const COLUMNS = sql`kind, enabled, recipient_roles, channels, delay_minutes, lead_minutes, revision`;
const SCOPED_COLUMNS = sql`branch_id, ${COLUMNS}`;

export const toStoredAlertRule = (row: Row): StoredAlertRule => ({
  kind: row.kind,
  enabled: row.enabled,
  recipientRoles: row.recipient_roles,
  channels: row.channels,
  delayMinutes: row.delay_minutes,
  leadMinutes: row.lead_minutes,
  revision: row.revision,
});

const scopeOf = (companyId: string, target: AlertRuleTarget) =>
  target.branchId === null
    ? sql`company_id = ${companyId} AND business_id = ${target.businessId} AND branch_id IS NULL`
    : sql`company_id = ${companyId} AND business_id = ${target.businessId} AND branch_id = ${target.branchId}`;

/**
 * القواعد المخزنة لنطاق واحد بالظبط (النشاط أو فرع واحد).
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param target    النشاط والفرع
 * @param lock      قفل الصفوف للكتابة
 * @returns القواعد حسب النوع
 */
export async function readStoredAlertRules(
  tx: Tx,
  companyId: string,
  target: AlertRuleTarget,
  lock = false,
): Promise<Map<AlertKind, StoredAlertRule>> {
  const rows = await tx.execute<Row>(sql`SELECT ${COLUMNS} FROM alert_rules
    WHERE ${scopeOf(companyId, target)} ORDER BY kind ${lock ? sql`FOR UPDATE` : sql``}`);
  return new Map(rows.map((row) => [row.kind, toStoredAlertRule(row)]));
}

/**
 * لقطة القواعد المخزنة والمفتاح العام: قواعد النشاط دايماً، وقواعد الفرع لو النطاق فيه فرع.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param target    النشاط والفرع
 * @returns المفتاح العام وقواعد النشاط وقواعد الفرع
 */
async function readAlertRulesSnapshot(
  tx: Tx,
  companyId: string,
  target: AlertRuleTarget,
): Promise<AlertRulesSnapshot> {
  const scope =
    target.branchId === null
      ? sql`branch_id IS NULL`
      : sql`(branch_id IS NULL OR branch_id = ${target.branchId})`;
  const rows = await tx.execute<ScopedRow>(sql`SELECT ${SCOPED_COLUMNS} FROM alert_rules
    WHERE company_id = ${companyId} AND business_id = ${target.businessId} AND ${scope}`);
  const [master] = await tx.execute<{ alerts_enabled: boolean | null }>(sql`SELECT alerts_enabled
    FROM business_settings WHERE company_id = ${companyId} AND business_id = ${target.businessId}`);
  return {
    alertsEnabled: master?.alerts_enabled ?? null,
    rules: rows.map((row) => ({ ...toStoredAlertRule(row), branchId: row.branch_id })),
  };
}

function scopeFor(tx: Tx, companyId: string, userId: string, ids: IdGenerator): AlertRulesScope {
  return {
    audit: transactionWriters(tx, ids).audit,
    access: (target) => lockAlertRulesAccess(tx, companyId, userId, target),
    lockRules: (target) => readStoredAlertRules(tx, companyId, target, true),
    snapshot: async (target) => readAlertRulesSnapshot(tx, companyId, target),
    saveRule: async (target, kind, settings, updatedBy) => {
      const conflict =
        target.branchId === null
          ? sql`(company_id, business_id, kind) WHERE branch_id IS NULL`
          : sql`(company_id, branch_id, kind) WHERE branch_id IS NOT NULL`;
      const [row] = await tx.execute<Row>(sql`
        INSERT INTO alert_rules (company_id, id, business_id, branch_id, kind, enabled, recipient_roles, channels,
          delay_minutes, lead_minutes, updated_by, updated_at, revision)
        VALUES (${companyId}, ${ids.newId()}, ${target.businessId}, ${target.branchId}, ${kind}, ${settings.enabled},
          ${sql.raw(textArray(settings.recipientRoles))}, ${sql.raw(textArray(settings.channels))},
          ${settings.delayMinutes}, ${settings.leadMinutes}, ${updatedBy}, now(), 1)
        ON CONFLICT ${conflict} DO UPDATE SET enabled = EXCLUDED.enabled,
          recipient_roles = EXCLUDED.recipient_roles, channels = EXCLUDED.channels,
          delay_minutes = EXCLUDED.delay_minutes, lead_minutes = EXCLUDED.lead_minutes,
          updated_by = EXCLUDED.updated_by, updated_at = now(), revision = alert_rules.revision + 1
        RETURNING ${COLUMNS}`);
      if (row === undefined) throw new Error('alert rule upsert returned no row');
      return toStoredAlertRule(row);
    },
    deleteBranchRule: async (target, kind) => {
      const [row] = await tx.execute<Row>(sql`DELETE FROM alert_rules
        WHERE ${scopeOf(companyId, target)} AND kind = ${kind} RETURNING ${COLUMNS}`);
      return row === undefined ? null : toStoredAlertRule(row);
    },
    lockMaster: async (businessId) => {
      await tx.execute(sql`INSERT INTO business_settings (company_id, business_id)
        VALUES (${companyId}, ${businessId}) ON CONFLICT (company_id, business_id) DO NOTHING`);
      const [row] = await tx.execute<{ alerts_enabled: boolean | null }>(sql`SELECT alerts_enabled
        FROM business_settings WHERE company_id = ${companyId} AND business_id = ${businessId} FOR UPDATE`);
      return row?.alerts_enabled ?? null;
    },
    saveMaster: async (businessId, enabled) => {
      await tx.execute(sql`UPDATE business_settings SET alerts_enabled = ${enabled}
        WHERE company_id = ${companyId} AND business_id = ${businessId}`);
    },
  };
}

function textArray(values: readonly string[]): string {
  if (values.some((value) => !/^[A-Za-z_]+$/.test(value))) throw new Error('unexpected array value');
  return `ARRAY[${values.map((value) => `'${value}'`).join(',')}]::text[]`;
}

/**
 * @param db  the tenant wrappers
 * @param ids the UUID v7 generator for rule and audit rows
 * @returns withTenant for the verified company around the alert-rules work
 */
export function createAlertRulesTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): AlertRulesTransactions {
  return {
    run: (companyId, userId, work) =>
      db.withTenant(companyId, (tx) => work(scopeFor(tx, companyId, userId, ids)), { userId }),
  };
}
