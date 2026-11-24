import { sql } from 'drizzle-orm';
import {
  appendAuditLog,
  lockStatementPeriods,
  type IdGenerator,
  type StatementStatus,
  type Tx,
} from '@pospay/db';

import type { BusinessCalendarPort } from '../ports/business-calendar.port.ts';
import type { CommissionStatementPayAccessPort } from '../ports/commission-statement-pay-access.port.ts';
import type {
  LockedStatementForPayment,
  MarkStatementPaidActor,
  MarkStatementPaidScope,
  StatementPaymentWrite,
} from '../ports/commission-statement-pay-transactions.port.ts';

/** قراء كاتب الصرف: تقويم النشاط وإعادة فحص صلاحية الصرف، مربوطين عند جذر التركيب. */
export interface CommissionStatementPayReaders {
  readonly businessCalendar: BusinessCalendarPort['read'];
  readonly access: CommissionStatementPayAccessPort['recheck'];
}

type FrozenRow = {
  readonly employee_id: string;
  readonly kind: string;
  readonly amount: string;
};

type LockedRow = {
  readonly statement_id: string;
  readonly status: string;
  readonly approved_at: string | null;
};

type PaidAtRow = { readonly paid_at: string };

/**
 * بيقفل صف شهر الكشف ويرجّع حالته وتاريخ اعتماده بعد القفل؛ الشهر الغايب بيتولد DRAFT زي أي قفل.
 *
 * @param tx    معاملة الصرف الحالية
 * @param actor الشركة والنشاط والشهر والمستخدم
 * @param ids   مولّد الـ ids الخاص بالمعاملة
 * @returns الشهر المقفول بمعرفه وحالته وتاريخ اعتماده
 */
async function lockStatement(
  tx: Tx,
  actor: MarkStatementPaidActor,
  ids: IdGenerator,
): Promise<LockedStatementForPayment> {
  const [locked] = await lockStatementPeriods(tx, {
    businessId: actor.businessId,
    periods: [actor.period],
    ids,
  });
  if (locked === undefined) throw new Error('The statement period is missing after its lock');
  const [row] = await tx.execute<LockedRow>(sql`
    SELECT id AS statement_id, status, approved_at FROM commission_statements
    WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
      AND period = ${actor.period}`);
  if (row === undefined) throw new Error('The statement row is invisible after its lock');
  return {
    statementId: row.statement_id,
    status: row.status as StatementStatus,
    approvedAt: row.approved_at === null ? null : new Date(row.approved_at),
  };
}

/**
 * بيكتب أعمدة الدفع على الكشف وصف دفع لكل موظفة مجمّدة، والترتيب مقصود: التحديث الأول
 * عشان حارس الإدراج يشوف دليل الدفع، والصفوف بعده في نفس المعاملة.
 *
 * @param tx     معاملة الصرف الحالية
 * @param actor  الشركة والنشاط
 * @param ids    مولّد الـ ids الخاص بالمعاملة
 * @param record أعمدة الدفع وصفوف الدفع المحسوبة من الـ domain
 * @returns وقت التسجيل بصيغة ISO على توقيت UTC
 */
async function writeStatementPayment(
  tx: Tx,
  actor: Pick<MarkStatementPaidActor, 'businessId'>,
  ids: IdGenerator,
  record: StatementPaymentWrite,
): Promise<{ readonly paidAt: string }> {
  await tx.execute(sql`
    UPDATE commission_statements SET status = 'PAID', paid_by = ${record.paidBy}::uuid,
      paid_at = now(), paid_on = ${record.paidOn}::date, paid_method = ${record.paidMethod},
      paid_note = ${record.paidNote}
    WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
      AND id = ${record.statementId}::uuid`);
  for (const payment of record.payments) {
    await tx.execute(sql`
      INSERT INTO commission_statement_payments(
        company_id,id,business_id,statement_id,employee_id,exact_payable,paid_amount)
      VALUES (app_company_id(),${ids.newId()}::uuid,${actor.businessId}::uuid,
        ${record.statementId}::uuid,${payment.employeeId}::uuid,
        ${payment.exactPayable},${payment.paidAmount})`);
  }
  const [row] = await tx.execute<PaidAtRow>(sql`
    SELECT to_char(paid_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
    FROM commission_statements
    WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
      AND id = ${record.statementId}::uuid`);
  if (row === undefined) throw new Error('The paid statement is invisible after its update');
  return { paidAt: row.paid_at };
}

/**
 * بيكتب تدقيق الصرف بتاريخيه ومجموعه في نفس المعاملة، بلا بيانات موظفة حساسة.
 *
 * @param tx     معاملة الصرف الحالية
 * @param actor  الشركة والنشاط
 * @param ids    مولّد الـ ids الخاص بالمعاملة
 * @param record الكتابة نفسها مع وقت التسجيل ومجموع المصروف
 */
async function auditStatementPayment(
  tx: Tx,
  actor: Pick<MarkStatementPaidActor, 'businessId'>,
  ids: IdGenerator,
  record: StatementPaymentWrite & { readonly paidAt: string; readonly paidTotal: string },
): Promise<void> {
  await appendAuditLog(tx, ids.newId(), {
    entity: 'commission_statement',
    entityId: record.statementId,
    action: 'commission_statement.paid',
    after: {
      business_id: actor.businessId,
      period: record.period,
      paid_by: record.paidBy,
      paid_at: record.paidAt,
      paid_on: record.paidOn,
      paid_method: record.paidMethod,
      ...(record.paidNote === null ? {} : { paid_note: record.paidNote }),
      paid_total: record.paidTotal,
    },
  });
}

/**
 * يبني خطوات معاملة الصرف على معاملة الكاتب: قفل الشهر والتقويم وإعادة فحص الصلاحية
 * وقراءة البنود المجمّدة والكتابة والتدقيق.
 */
export function createCommissionStatementPayScope(
  tx: Tx,
  actor: MarkStatementPaidActor,
  ids: IdGenerator,
  readers: CommissionStatementPayReaders,
): MarkStatementPaidScope {
  return {
    lockStatement: () => lockStatement(tx, actor, ids),
    calendar: () => readers.businessCalendar(tx, actor.companyId, actor.businessId),
    recheckAccess: () => readers.access(tx, actor.companyId, actor.userId, actor.businessId),
    frozenLines: async (statementId) => {
      const rows = await tx.execute<FrozenRow>(sql`
        SELECT employee_id, kind, amount::text AS amount FROM commission_statement_lines
        WHERE company_id = app_company_id() AND business_id = ${actor.businessId}::uuid
          AND statement_id = ${statementId}::uuid
        ORDER BY created_at, id`);
      return rows.map((row) => ({
        employeeId: row.employee_id,
        kind: row.kind,
        amount: row.amount,
      }));
    },
    markPaid: (record) => writeStatementPayment(tx, actor, ids, record),
    audit: (record) => auditStatementPayment(tx, actor, ids, record),
  };
}
