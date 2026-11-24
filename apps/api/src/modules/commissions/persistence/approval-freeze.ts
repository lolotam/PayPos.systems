import {
  statementAttachmentFromStored,
  statementRowFromStored,
  type StatementAttachmentRow,
  type StatementRow,
  type StoredStatementAttachment,
  type StoredStatementLine,
} from '@pospay/commissions-engine';
import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  ApprovalStamp,
  FrozenStatementRead,
} from '../ports/commission-statement-approve.port.ts';

// حجم الدفعة: عبارة واحدة لكل دفعة تكفي ألوف الصفوف دون أن يكبر معامل JSON عن حدود السائق (FR-033).
const FREEZE_BATCH = 500;

interface FreezeActor {
  readonly userId: string;
  readonly businessId: string;
}

/**
 * يحدّث صف الكشف REVIEWED إلى APPROVED في أمر واحد بالمعتمِد وبصمتي المدخلات والكشف؛ التريغر هو الذي يكتب دليل
 * معاملة الاعتماد، والقيد يرفض أي بصمة لا تساوي بصمة المراجعة (FR-034).
 *
 * @param tx معاملة الاعتماد
 * @param actor المعتمِد والنشاط
 * @param stamp معرّف الكشف والبصمتان
 */
export async function markStatementApproved(
  tx: Tx,
  actor: FreezeActor,
  stamp: ApprovalStamp,
): Promise<void> {
  const rows = await tx.execute(sql`UPDATE commission_statements
    SET status = 'APPROVED', input_fingerprint = ${stamp.inputFingerprint},
        statement_fingerprint = ${stamp.statementFingerprint}, approved_by = ${actor.userId}::uuid,
        approved_at = now(), revision = revision + 1
    WHERE company_id = app_company_id() AND id = ${stamp.statementId}::uuid
      AND business_id = ${actor.businessId}::uuid AND status = 'REVIEWED'
    RETURNING id`);
  if (rows.length !== 1) throw new Error('The statement left REVIEWED while it was locked');
}

/**
 * يدخل صفوف الباني وارتباطات الموظفات كما بُنيت، في إدخال واحد لكل دفعة (FR-033). الحارس في قاعدة البيانات يقبلها
 * في معاملة الاعتماد وحدها.
 *
 * @param tx معاملة الاعتماد
 * @param ids مولّد معرّفات الصفوف
 * @param actor النشاط الذي يُجمَّد كشفه
 * @param statementId الكشف المعتمَد
 * @param rows صفوف الباني
 * @param attachments لقطة ارتباطات الفروع
 */
export async function freezeStatementRows(
  tx: Tx,
  ids: IdGenerator,
  actor: FreezeActor,
  statementId: string,
  rows: readonly StatementRow[],
  attachments: readonly StatementAttachmentRow[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += FREEZE_BATCH) {
    const batch = rows.slice(start, start + FREEZE_BATCH).map((row) => lineJson(row, ids.newId()));
    await insertLines(tx, actor.businessId, statementId, batch);
  }
  for (let start = 0; start < attachments.length; start += FREEZE_BATCH) {
    const batch = attachments
      .slice(start, start + FREEZE_BATCH)
      .map((row) => ({ id: ids.newId(), ...row }));
    await insertAttachments(tx, actor.businessId, statementId, batch);
  }
}

function lineJson(row: StatementRow, id: string): Record<string, unknown> {
  return {
    id,
    employee_id: row.employeeId,
    employee_number: row.employeeNumber,
    employee_name_ar: row.employeeNameAr,
    employee_name_en: row.employeeNameEn,
    source_ref: row.sourceRef,
    kind: row.kind,
    amount: row.amount,
    previous_amount: row.previousAmount,
    new_amount: row.newAmount,
    source_period: row.sourcePeriod,
    source_branch_id: row.sourceBranchId,
    source_branch_name_ar: row.sourceBranchNameAr,
    source_branch_name_en: row.sourceBranchNameEn,
    source_business_date: row.sourceBusinessDate,
    attached_branch_ids: row.attachedBranchIds,
    line_id: row.lineId,
    session_id: row.sessionId,
    service_id: row.serviceId,
    service_name_ar: row.serviceNameAr,
    service_name_en: row.serviceNameEn,
    customer_id: row.customerId,
    customer_name: row.customerName,
    business_date: row.businessDate,
  };
}

async function insertLines(
  tx: Tx,
  businessId: string,
  statementId: string,
  batch: readonly Record<string, unknown>[],
): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_statement_lines (company_id, id, business_id, statement_id,
      employee_id, employee_number, employee_name_ar, employee_name_en, source_ref, kind, amount, previous_amount,
      new_amount, source_period, source_branch_id, source_branch_name_ar, source_branch_name_en,
      source_business_date, attached_branch_ids, line_id, session_id, service_id, service_name_ar, service_name_en,
      customer_id, customer_name, business_date)
    SELECT app_company_id(), r.id, ${businessId}::uuid, ${statementId}::uuid, r.employee_id, r.employee_number,
      r.employee_name_ar, r.employee_name_en, r.source_ref, r.kind, r.amount, r.previous_amount, r.new_amount,
      r.source_period, r.source_branch_id, r.source_branch_name_ar, r.source_branch_name_en,
      r.source_business_date, r.attached_branch_ids, r.line_id, r.session_id, r.service_id, r.service_name_ar,
      r.service_name_en, r.customer_id, r.customer_name, r.business_date
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(id uuid, employee_id uuid, employee_number integer,
      employee_name_ar text, employee_name_en text, source_ref text, kind text, amount numeric,
      previous_amount numeric, new_amount numeric, source_period text, source_branch_id uuid,
      source_branch_name_ar text, source_branch_name_en text, source_business_date date,
      attached_branch_ids uuid[], line_id uuid, session_id uuid, service_id uuid, service_name_ar text,
      service_name_en text, customer_id uuid, customer_name text, business_date date)`);
}

async function insertAttachments(
  tx: Tx,
  businessId: string,
  statementId: string,
  batch: readonly Record<string, unknown>[],
): Promise<void> {
  await tx.execute(sql`INSERT INTO commission_statement_attachments (company_id, id, business_id, statement_id,
      employee_id, branch_id, attached_from, attached_to)
    SELECT app_company_id(), r.id, ${businessId}::uuid, ${statementId}::uuid, r."employeeId", r."branchId",
      r."attachedFrom", r."attachedTo"
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(id uuid, "employeeId" uuid, "branchId" uuid,
      "attachedFrom" date, "attachedTo" date)`);
}

/**
 * يقرأ الصفوف المجمّدة وارتباطاتها لإعادة حساب بصمة الكشف منها، أو لعرض شهر مغلق (FR-025).
 *
 * @param tx معاملة بسياق الشركة
 * @param statementId الكشف المعتمَد
 * @returns الصفوف والارتباطات بالشكل القياسي
 */
export async function readFrozenStatement(
  tx: Tx,
  statementId: string,
): Promise<FrozenStatementRead> {
  const lines = await tx.execute<StoredStatementLine & Record<string, unknown>>(sql`SELECT employee_id, employee_number, employee_name_ar,
      employee_name_en, source_ref, kind, amount::text AS amount, previous_amount::text AS previous_amount,
      new_amount::text AS new_amount, source_period, source_branch_id, source_branch_name_ar,
      source_branch_name_en, source_business_date::text AS source_business_date, attached_branch_ids, line_id,
      session_id, service_id, service_name_ar, service_name_en, customer_id, customer_name,
      business_date::text AS business_date
    FROM commission_statement_lines
    WHERE company_id = app_company_id() AND statement_id = ${statementId}::uuid
    ORDER BY employee_id, source_ref`);
  const attachments = await tx.execute<StoredStatementAttachment & Record<string, unknown>>(sql`SELECT employee_id, branch_id,
      attached_from::text AS attached_from, attached_to::text AS attached_to
    FROM commission_statement_attachments
    WHERE company_id = app_company_id() AND statement_id = ${statementId}::uuid
    ORDER BY employee_id, branch_id, attached_from`);
  return {
    rows: lines.map(statementRowFromStored),
    attachments: attachments.map(statementAttachmentFromStored),
  };
}

/**
 * وقت الاعتماد المخزّن كنص ISO بتوقيت UTC لرد الاعتماد وعرض الشهر المغلق.
 *
 * @param tx معاملة بسياق الشركة
 * @param statementId الكشف
 * @returns وقت الاعتماد، أو null لكشف لم يُعتمد
 */
export async function readApprovedAt(tx: Tx, statementId: string): Promise<string | null> {
  const [row] = await tx.execute<{ approved_at: string | null }>(sql`SELECT
      to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS approved_at
    FROM commission_statements WHERE company_id = app_company_id() AND id = ${statementId}::uuid`);
  return row?.approved_at ?? null;
}
