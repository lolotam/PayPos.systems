import { moneyToString, sumMoney } from '@pospay/domain';
import { compareEmployeeId } from './employee-order.ts';
import type { TipEntry } from './tip-set.ts';

/** رأس الزيارة الذي تُبنى منه حمولة الحدث؛ المنطقة الزمنية للنافذة ولا تخرج في الحدث. */
export interface TipRevisionSession {
  id: string;
  business_id: string;
  branch_id: string;
  occurred_at: Date;
  business_date: string;
  business_timezone: string;
}

/** لقطة مراجعة بالمبلغ بالفلس قبل تحويلها إلى نص النقل. */
export interface TipAuditSnapshot {
  revision: number;
  entries: readonly TipEntry[];
}

function compareTipEntries(left: TipEntry, right: TipEntry): number {
  const byEmployee = compareEmployeeId(left.employee_id, right.employee_id);
  if (byEmployee !== 0) return byEmployee;
  return left.method < right.method ? -1 : left.method > right.method ? 1 : 0;
}

function sortEntries(entries: readonly TipEntry[]): TipEntry[] {
  return [...entries].sort(compareTipEntries);
}

function wireEntry(entry: TipEntry) {
  return {
    employee_id: entry.employee_id,
    method: entry.method,
    amount: moneyToString(entry.amount),
  };
}

function totalsByMethod(entries: readonly TipEntry[]) {
  const amounts = (method: TipEntry['method']) =>
    entries.filter((entry) => entry.method === method).map((entry) => entry.amount);
  return {
    total_cash: moneyToString(sumMoney(amounts('CASH'))),
    total_card: moneyToString(sumMoney(amounts('CARD'))),
  };
}

/**
 * يبني جسم SessionTips من المراجعة والسطور، بالمال نصاً من ثلاث خانات.
 * الترتيب بالهوية ثم الطريقة حتى يتطابق الرد مع الحدث، وCARD تسبق CASH لأن المقارنة نصية مثل تصنيف 36-2.
 * الإجمالي يُجمع من السطور بعد تقريبها، والسقف فُحص قبل هذا البناء.
 *
 * @param revision رقم المراجعة الحالية، وصفر يعني أنه لا بقشيش محفوظ بعد
 * @param entries سطور المراجعة بالمبلغ بالفلس
 * @returns جسم الرد: المراجعة والسطور المرتبة وإجمالي النقد والبطاقة
 */
export function tipSetResponse(revision: number, entries: readonly TipEntry[]) {
  return { revision, tips: sortEntries(entries).map(wireEntry), ...totalsByMethod(entries) };
}

/**
 * يبني حمولة SessionTipsChanged من رأس الزيارة والمراجعة الجديدة.
 * الحدث يحمل المجموعة الحالية كاملة بلا سبب ولا هاتف ولا عميلة، لأن المستهلك يحسب الإسقاط من المجموعة لا من الفرق.
 *
 * @param session رأس الزيارة المحفوظ
 * @param revision رقم المراجعة التي كُتبت في هذه المعاملة
 * @param changedAt وقت المراجعة المحقون
 * @param entries المجموعة الحالية كاملة بالمبلغ بالفلس
 * @returns حمولة الحدث بالنسخة 1 والمال نصاً من ثلاث خانات
 */
export function sessionTipsChangedEvent(
  session: TipRevisionSession,
  revision: number,
  changedAt: Date,
  entries: readonly TipEntry[],
) {
  return {
    session_id: session.id,
    business_id: session.business_id,
    branch_id: session.branch_id,
    occurred_at: session.occurred_at.toISOString(),
    business_date: session.business_date,
    revision,
    changed_at: changedAt.toISOString(),
    tips: sortEntries(entries).map(wireEntry),
    schema_version: 1 as const,
  };
}

/**
 * يبني أثر تدقيق البقشيش بلا سبب وبلا هاتف.
 * المراجعة الأولى تسجيل وما بعدها استبدال، لأن الصفوف المالية لا تُحذف.
 *
 * @param before المجموعة السابقة، أو null عند أول مراجعة
 * @param after المجموعة بعد الحفظ
 * @returns أثر service_session_tips بالمبالغ نصاً من ثلاث خانات
 */
export function sessionTipsAudit(before: TipAuditSnapshot | null, after: TipAuditSnapshot) {
  const snapshot = (value: TipAuditSnapshot) => ({
    revision: value.revision,
    entries: sortEntries(value.entries).map(wireEntry),
  });
  return {
    entity: 'service_session_tips' as const,
    action: after.revision === 1 ? ('tips.recorded' as const) : ('tips.replaced' as const),
    before: before === null ? null : snapshot(before),
    after: snapshot(after),
  };
}
