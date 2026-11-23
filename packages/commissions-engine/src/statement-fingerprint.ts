import { moneyToString, parseMoney } from '@pospay/domain';

import { sortedBy } from './canonical-format.ts';
import type { StatementAttachmentRow, StatementRow, StatementRowKind } from './statement-types.ts';

/**
 * صف `commission_statement_lines` كما بيرجع من قاعدة البيانات: `numeric` و`date` نصوص، و`uuid[]`
 * بترتيبه المخزّن. الأعمدة الزيادة (id وstatement_id وcompany_id وbusiness_id وcreated_at)
 * بتتجاهل لأنها مش موجودة قبل التجميد.
 */
export interface StoredStatementLine {
  readonly employee_id: string;
  readonly employee_number: number;
  readonly employee_name_ar: string | null;
  readonly employee_name_en: string;
  readonly source_ref: string;
  readonly kind: StatementRowKind;
  readonly amount: string;
  readonly previous_amount: string | null;
  readonly new_amount: string | null;
  readonly source_period: string | null;
  readonly source_branch_id: string | null;
  readonly source_branch_name_ar: string | null;
  readonly source_branch_name_en: string | null;
  readonly source_business_date: string | null;
  readonly attached_branch_ids: readonly string[];
  readonly line_id: string | null;
  readonly session_id: string | null;
  readonly service_id: string | null;
  readonly service_name_ar: string | null;
  readonly service_name_en: string | null;
  readonly customer_id: string | null;
  readonly customer_name: string | null;
  readonly business_date: string | null;
}

/** صف `commission_statement_attachments` كما بيرجع من قاعدة البيانات. */
export interface StoredStatementAttachment {
  readonly employee_id: string;
  readonly branch_id: string;
  readonly attached_from: string;
  readonly attached_to: string;
}

/**
 * المبلغ النصي بيرجع لصيغة KWD القياسية بعد التحقق منه، فـ 12.5 و12.500 بصمتهم واحدة.
 *
 * @param text المبلغ كما رجع من قاعدة البيانات
 * @returns المبلغ بثلاث منازل
 */
function normalizedMoney(text: string): string {
  return moneyToString(parseMoney(text));
}

/**
 * يحوّل الصف المقروء من قاعدة البيانات لنفس شكل صف الباني، عشان بصمة الكشف بعد التجميد
 * تتحسب بنفس الدالة اللي حسبت بصمة المراجعة (FR-032، CM-34e).
 *
 * @param row الصف كما رجع من قاعدة البيانات
 * @returns صف الكشف بالشكل القياسي
 */
export function statementRowFromStored(row: StoredStatementLine): StatementRow {
  return {
    employeeId: row.employee_id,
    employeeNumber: row.employee_number,
    employeeNameAr: row.employee_name_ar,
    employeeNameEn: row.employee_name_en,
    sourceRef: row.source_ref,
    kind: row.kind,
    amount: normalizedMoney(row.amount),
    previousAmount: row.previous_amount === null ? null : normalizedMoney(row.previous_amount),
    newAmount: row.new_amount === null ? null : normalizedMoney(row.new_amount),
    sourcePeriod: row.source_period,
    sourceBranchId: row.source_branch_id,
    sourceBranchNameAr: row.source_branch_name_ar,
    sourceBranchNameEn: row.source_branch_name_en,
    sourceBusinessDate: row.source_business_date,
    attachedBranchIds: row.attached_branch_ids,
    lineId: row.line_id,
    sessionId: row.session_id,
    serviceId: row.service_id,
    serviceNameAr: row.service_name_ar,
    serviceNameEn: row.service_name_en,
    customerId: row.customer_id,
    customerName: row.customer_name,
    businessDate: row.business_date,
  };
}

/**
 * يحوّل صف المرفق المقروء لشكل الباني.
 *
 * @param row الصف كما رجع من قاعدة البيانات
 * @returns مرفق الكشف بالشكل القياسي
 */
export function statementAttachmentFromStored(
  row: StoredStatementAttachment,
): StatementAttachmentRow {
  return {
    employeeId: row.employee_id,
    branchId: row.branch_id,
    attachedFrom: row.attached_from,
    attachedTo: row.attached_to,
  };
}

/**
 * صف الكشف بمفاتيحه القياسية؛ attached_branch_ids مرتبة، والباقي زي ما هو.
 *
 * @param row صف الكشف
 * @returns شكل JSON آمن
 */
function rowJson(row: StatementRow): object {
  return {
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
    attached_branch_ids: [...row.attachedBranchIds].sort(),
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

/**
 * يبني مدخل بصمة الكشف (D-6) من صفوف الباني أو من الصفوف المقروءة بعد التجميد بعد
 * `statementRowFromStored`: نفس الدالة للاتنين.
 *
 * العقد الكامل (ثابت، وأي تغيير فيه يغيّر كل البصمات المخزنة):
 * - الصفوف مرتبة بـ (employee_id, source_ref)، ثم المرفقات بـ (employee_id, branch_id, attached_from).
 * - داخل: كل أعمدة الصف اللي بتتجمّد، بما فيها بطاقة الموظفة وأسماء الفرع والخدمة والعميل،
 *   عشان تغيير اسم بين المراجعة والاعتماد يرفض الاعتماد.
 * - مش داخل: id وstatement_id وcompany_id وbusiness_id والـ timestamps.
 * - المبالغ نصوص KWD بثلاث منازل، والتواريخ YYYY-MM-DD، والغائب `null`، و`attached_branch_ids`
 *   مرتبة بالنص، والمرفق بـ `attached_to` آخر يوم داخل.
 *
 * @param rows صفوف الكشف
 * @param attachments مرفقات الكشف
 * @returns شكل JSON آمن لـ canonicalJson
 */
export function statementFingerprintInput(
  rows: readonly StatementRow[],
  attachments: readonly StatementAttachmentRow[],
): { readonly lines: readonly object[]; readonly attachments: readonly object[] } {
  return {
    lines: sortedBy(rows, (row) => [row.employeeId, row.sourceRef]).map(rowJson),
    attachments: sortedBy(attachments, (row) => [
      row.employeeId,
      row.branchId,
      row.attachedFrom,
    ]).map((row) => ({
      employee_id: row.employeeId,
      branch_id: row.branchId,
      attached_from: row.attachedFrom,
      attached_to: row.attachedTo,
    })),
  };
}
