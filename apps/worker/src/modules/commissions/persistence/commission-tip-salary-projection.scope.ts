import { reopenReviewedStatementPeriods, type Tx } from '@pospay/db';
import { moneyToString, parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import { periodOfBusinessDate } from '../domain/commission-lines.ts';
import type { IdGenerator } from '../ports/commission-line-projection.port.ts';
import type { BusinessTimeZoneReader } from './commission-line-projection.scope.ts';
import { lockCommissionPeriods } from './commission-period-locks.ts';
import type {
  CommissionSalaryProjectionRow,
  CommissionTipMethod,
  CommissionTipProjectionSession,
} from '../domain/commission-tip-salary-inputs.ts';
import type {
  CommissionSalaryProjectionScope,
  CommissionSalaryProjectionWrite,
  CommissionTipProjectionScope,
  HeldCommissionTipProjectionSession,
} from '../ports/commission-tip-salary-projection.port.ts';

export type EmployeeBusinessReader = (
  tx: Tx,
  companyId: string,
  employeeId: string,
) => Promise<string | null>;

export type BusinessCalendarReader = (
  tx: Tx,
  companyId: string,
  businessId: string,
) => Promise<{ readonly timeZone: string; readonly createdAt: Date } | null>;

type TipHeadRow = Omit<HeldCommissionTipProjectionSession, 'rows'>;
type TipAmountRow = {
  employeeId: string;
  method: CommissionTipMethod;
  amount: string;
};
type SalaryRow = Omit<CommissionSalaryProjectionRow, 'amount'> & { amount: string };

export function createCommissionTipProjectionScope(
  tx: Tx,
  businessTimeZone: BusinessTimeZoneReader,
  ids: IdGenerator,
): CommissionTipProjectionScope {
  return {
    lockSession: async (sessionId) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended(app_company_id()::text || ':commission-tip-session:' || ${sessionId}::uuid::text, 0))`);
    },
    readTipSession: (sessionId) => readTipSession(tx, sessionId),
    businessTimeZone: (companyId, businessId) => businessTimeZone(tx, companyId, businessId),
    lockPeriods: (input) => lockCommissionPeriods(tx, input),
    replaceTipSession: (session) => replaceTipSession(tx, ids, session),
    reopenReviewed: (input) => reopenReviewedStatementPeriods(tx, input),
  };
}

export function createCommissionSalaryProjectionScope(
  tx: Tx,
  businessCalendar: BusinessCalendarReader,
  employeeBusiness: EmployeeBusinessReader,
): CommissionSalaryProjectionScope {
  return {
    lockEmployee: async (employeeId) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended(app_company_id()::text || ':commission-salary-employee:' || ${employeeId}::uuid::text, 0))`);
    },
    lockSalaryIdentity: async (employeeId, effectiveFrom) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtextextended(app_company_id()::text || ':commission-salary:' || ${employeeId}::uuid::text || ':' || ${effectiveFrom}::date::text, 0))`);
    },
    employeeBusiness: (companyId, employeeId) => employeeBusiness(tx, companyId, employeeId),
    readSalary: (employeeId, effectiveFrom) => readSalary(tx, employeeId, effectiveFrom),
    readNextEffectiveFrom: async (employeeId, effectiveFrom) => {
      const [row] = await tx.execute<{ effectiveFrom: string }>(sql`
        SELECT effective_from::text AS "effectiveFrom" FROM commission_salaries
        WHERE company_id=app_company_id() AND employee_id=${employeeId}::uuid
          AND effective_from>${effectiveFrom}::date
        ORDER BY effective_from ASC LIMIT 1`);
      return row?.effectiveFrom ?? null;
    },
    businessCalendar: (companyId, businessId) => businessCalendar(tx, companyId, businessId),
    lockPeriods: (input) => lockCommissionPeriods(tx, input),
    upsertSalary: (row) => upsertSalary(tx, row),
    reopenReviewed: (input) => reopenReviewedStatementPeriods(tx, input),
  };
}

async function readTipSession(
  tx: Tx,
  sessionId: string,
): Promise<HeldCommissionTipProjectionSession | null> {
  const [head] = await tx.execute<TipHeadRow>(sql`SELECT
    business_id AS "businessId",session_id AS "sessionId",branch_id AS "branchId",
    business_date::text AS "businessDate",revision,period
    FROM commission_tip_heads
    WHERE company_id=app_company_id() AND session_id=${sessionId}::uuid`);
  if (head === undefined) return null;
  const rows = await tx.execute<TipAmountRow>(sql`SELECT
    employee_id AS "employeeId",method,amount::text AS amount
    FROM commission_tips
    WHERE company_id=app_company_id() AND session_id=${sessionId}::uuid
    ORDER BY employee_id,method`);
  return {
    ...head,
    rows: rows.map((row) => ({
      employeeId: row.employeeId,
      method: row.method,
      amount: parseMoney(row.amount),
    })),
  };
}

async function replaceTipSession(
  tx: Tx,
  ids: IdGenerator,
  session: CommissionTipProjectionSession,
): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_tip_heads(
    company_id,id,business_id,session_id,branch_id,revision,business_date,period)
    VALUES(app_company_id(),${ids.newId()}::uuid,${session.businessId}::uuid,
      ${session.sessionId}::uuid,${session.branchId}::uuid,${session.revision},
      ${session.businessDate}::date,${periodOfBusinessDate(session.businessDate)})
    ON CONFLICT (company_id,session_id) DO UPDATE SET
      revision=EXCLUDED.revision,branch_id=EXCLUDED.branch_id,
      business_date=EXCLUDED.business_date,period=EXCLUDED.period`);
  await tx.execute(sql`DELETE FROM commission_tips
    WHERE company_id=app_company_id() AND session_id=${session.sessionId}::uuid`);
  if (session.rows.length === 0) return;
  await tx.execute(sql`INSERT INTO commission_tips(
    company_id,id,business_id,session_id,employee_id,method,amount)
    VALUES ${sql.join(
      session.rows.map(
        (row) => sql`(app_company_id(),${ids.newId()}::uuid,${session.businessId}::uuid,
          ${session.sessionId}::uuid,${row.employeeId}::uuid,${row.method},${moneyToString(row.amount)})`,
      ),
      sql`, `,
    )}`);
}

async function readSalary(
  tx: Tx,
  employeeId: string,
  effectiveFrom: string,
): Promise<CommissionSalaryProjectionRow | null> {
  const [row] = await tx.execute<SalaryRow>(sql`SELECT
    business_id AS "businessId",employee_id AS "employeeId",
    effective_from::text AS "effectiveFrom",amount::text AS amount,revision
    FROM commission_salaries
    WHERE company_id=app_company_id() AND employee_id=${employeeId}::uuid
      AND effective_from=${effectiveFrom}::date`);
  if (row === undefined) return null;
  return { ...row, amount: parseMoney(row.amount) };
}

async function upsertSalary(tx: Tx, row: CommissionSalaryProjectionWrite): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_salaries(
    company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(app_company_id(),${row.id}::uuid,${row.businessId}::uuid,${row.employeeId}::uuid,
      ${row.effectiveFrom}::date,${moneyToString(row.amount)},${row.revision})
    ON CONFLICT (company_id,employee_id,effective_from) DO UPDATE SET
      amount=EXCLUDED.amount,revision=EXCLUDED.revision`);
}
