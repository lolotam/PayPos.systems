import { SessionError } from './session-error.ts';
import { prepareSessionLine, type SessionPreparationFacts } from './prepare-session-lines.ts';
import { equalShares, performerWarnings, validateRecorderPerformers, validateShares } from './session-performers.ts';
import type { PackageSessionDraft, PreparedSessionLine, SessionDraft, SessionLineRedemption } from './session-types.ts';

/** حقائق الباقة وقت الزيارة: آخر يوم تُقبل فيه، ولحظة بيعها. */
export interface PackageRedemptionFacts {
  /** آخر يوم تُقبل فيه الزيارة؛ تاريخ بلا وقت، بتوقيت فرع الخدمة. */
  expiresOn: string;
  /** لحظة البيع؛ الباقة المستوردة بلا وقت بيع، فلا حدّ أدنى لها. */
  soldAt: Date | null;
}

/** جلسة باقة مرشّحة: أقل جلسة FREE في المكوّن وقت القفل. */
export interface PackageSlotCandidate {
  id: string;
  ordinal: number;
  unit_value: bigint;
}

/** مسودة باقة بعد القفل: تحمل الجلسة المختارة وقيمتها المخزنة. */
export interface PackagePreparedDraft extends PackageSessionDraft {
  /** هوية الاسترداد ومكونه وجلسته وترتيبها. */
  redemption: SessionLineRedemption;
  /** قيمة الجلسة المخزنة، وهي مال السطر كاملاً بلا خصم. */
  unit_value: bigint;
}

/**
 * يرفض الزيارة بعد تاريخ انتهاء الباقة.
 * القاعدة: المقارنة على تاريخ الزيارة بتوقيت فرع الخدمة، لا بتاريخ الباقة ولا بتاريخ اليوم.
 *
 * @param visitLocalDate تاريخ الزيارة بيومها بتوقيت فرع الخدمة
 * @param expiresOn تاريخ انتهاء الباقة
 * @returns لا شيء؛ ترمي PACKAGE_EXPIRED إذا انتهت الباقة قبل الزيارة
 */
export function assertPackageNotExpired(visitLocalDate: string, expiresOn: string): void {
  if (visitLocalDate > expiresOn) throw new SessionError('PACKAGE_EXPIRED', { expires_on: expiresOn, visit_date: visitLocalDate });
}

/**
 * يرفض الزيارة قبل لحظة بيع الباقة.
 * القاعدة: المقارنة على اللحظات لا على التواريخ، فزيارة قبل البيع تُرفض مهما كان أي تاريخ محلي.
 * والباقة المستوردة بلا لحظة بيع، فليست لها حدّ أدنى.
 *
 * @param occurredAt لحظة الزيارة الفعلية
 * @param soldAt لحظة البيع، أو null للباقة المستوردة
 * @returns لا شيء؛ ترمي PACKAGE_NOT_YET_VALID إذا سبقت الزيارة البيع
 */
export function assertPackageNotYetValid(occurredAt: Date, soldAt: Date | null): void {
  if (soldAt !== null && occurredAt.getTime() < soldAt.getTime()) throw new SessionError('PACKAGE_NOT_YET_VALID');
}

/**
 * يجمع شرطي صلاحية الباقة للزيارة: الانتهاء أولاً ثم حدّ البيع الأدنى.
 * القاعدة: انتهاء الباقة يُفحص على تاريخ الزيارة، وحدّ البيع على اللحظات.
 *
 * @param facts حقائق الباقة المقفولة
 * @param visitLocalDate تاريخ الزيارة بيومها بتوقيت فرع الخدمة
 * @param occurredAt لحظة الزيارة الفعلية
 * @returns لا شيء؛ ترمي رمز الرفض المناسب
 */
export function assertPackageRedemptionAllowed(facts: PackageRedemptionFacts, visitLocalDate: string, occurredAt: Date): void {
  assertPackageNotExpired(visitLocalDate, facts.expiresOn);
  assertPackageNotYetValid(occurredAt, facts.soldAt);
}

/**
 * يوزّع جلسات المكوّن الحرة على مسوداته بترتيب الطلب.
 * القاعدة: كل مسودة تأخذ أقل جلسة FREE في مكوّنها، فمسودتان لنفس المكوّن تأخذان k و k+1.
 * ومكوّن بلا جلسة حرة يرفض الطلب كله، فلا تُحفظ زيارة ناقصة.
 *
 * @param drafts مسودات الباقة بترتيب الطلب ومع كل مسودة مكوّنها
 * @param slots أقل الجلسات الحرة لكل مكوّن
 * @returns الجلسة المختارة لكل مسودة بترتيب الطلب
 */
export function assignPackageSlots(
  drafts: readonly (PackageSessionDraft & { component_id: string })[],
  slots: ReadonlyMap<string, readonly PackageSlotCandidate[]>,
): Map<number, PackageSlotCandidate> {
  const taken = new Map<string, number>();
  const assigned = new Map<number, PackageSlotCandidate>();
  for (const draft of drafts) {
    const index = taken.get(draft.component_id) ?? 0;
    const candidate = slots.get(draft.component_id)?.[index];
    if (candidate === undefined) throw new SessionError('PACKAGE_NO_FREE_SESSION', { input_index: draft.input_index, component_id: draft.component_id });
    taken.set(draft.component_id, index + 1);
    assigned.set(draft.input_index, candidate);
  }
  return assigned;
}

/**
 * يحسب عدد الجلسات المطلوبة لكل مكوّن من مسودات الباقة.
 * القاعدة: مسودتان لنفس المكوّن تعني جلستين، والعدد هو ما يُطلب قفله من الجلسات الحرة.
 *
 * @param drafts مسودات الباقة ومع كل مسودة مكوّنها
 * @returns عدد الجلسات المطلوبة لكل معرّف مكوّن
 */
export function countPackageSlots(drafts: readonly { component_id: string }[]): Map<string, number> {
  const wanted = new Map<string, number>();
  for (const draft of drafts) wanted.set(draft.component_id, (wanted.get(draft.component_id) ?? 0) + 1);
  return wanted;
}

/**
 * يحضّر سطر الباقة بنفس قواعد السطر المدفوع، وماله من قيمة الجلسة المخزنة.
 * القاعدة: سعر السطر وصافيه قيمة الجلسة، والخصم صفر ونسبة الخصم الفعلي صفر (FR-025).
 * وقواعد الموظفات هي نفسها: عدد المنفّذين، الأهلية، التحذيرات، وقاعدة تنفيذ الخدمة بمصوّرة المسجّلة.
 *
 * @param draft مسودة الباقة بعد القفل
 * @param facts حقائق التجهيز المشتركة
 * @returns البند المتحقق منه قبل فحص سلطة الخصم
 */
export function preparePackageSessionLine(draft: PackagePreparedDraft, facts: SessionPreparationFacts): PreparedSessionLine {
  const input_index = draft.input_index;
  const service = facts.serviceById.get(draft.service_id);
  if (service === undefined) throw new SessionError('SESSION_SERVICE_NOT_FOUND', { input_index, service_id: draft.service_id });
  const shares = validateShares(draft.performers, input_index);
  const performers = draft.performers.map((p, index) => {
    const employee = facts.employeeById.get(p.employee_id);
    if (employee === undefined || !employee.eligible) throw new SessionError('SESSION_PERFORMER_NOT_ELIGIBLE', { input_index, employee_id: p.employee_id });
    return { employee, share_bps: shares[index] as number, ...performerWarnings(employee) };
  });
  validateRecorderPerformers(facts.userId, performers.map((p) => p.employee));
  const defaults = equalShares(performers.length);
  return { input_index, service, list_price: draft.unit_value, price: draft.unit_value, discount: 0n, net: draft.unit_value,
    effective_discount_bps: 0, performers,
    has_performer_warning: performers.some((p) => p.not_clocked_in_warning || p.approved_leave_warning),
    explicit_unequal_shares: draft.performers.every((p) => p.share_bps !== undefined) && shares.some((s, i) => s !== defaults[i]),
    redemption: draft.redemption };
}

/**
 * يحضّر بنود الزيارة كلها بترتيب الطلب، مدفوعة وباقة، فيفشل الطلب عند أول بند غلط.
 * القاعدة: ترتيب الطلب هو ترتيب البنود وترتيب أرقامها، ومال سطر الباقة من جلسته.
 *
 * @param paid مسودات البنود المدفوعة
 * @param packages مسودات بنود الباقة بعد القفل
 * @param facts حقائق التجهيز المشتركة
 * @returns البنود المحضّرة بترتيب الطلب
 */
export function prepareVisitLines(
  paid: readonly SessionDraft[],
  packages: readonly PackagePreparedDraft[],
  facts: SessionPreparationFacts,
): PreparedSessionLine[] {
  const paidByIndex = new Map(paid.map((draft) => [draft.input_index, draft]));
  const packageByIndex = new Map(packages.map((draft) => [draft.input_index, draft]));
  const indexes = [...paidByIndex.keys(), ...packageByIndex.keys()].sort((a, b) => a - b);
  return indexes.map((input_index) => {
    const packageDraft = packageByIndex.get(input_index);
    if (packageDraft !== undefined) return preparePackageSessionLine(packageDraft, facts);
    const paidDraft = paidByIndex.get(input_index);
    if (paidDraft === undefined) throw new SessionError('SESSION_SERVICE_NOT_FOUND', { input_index });
    return prepareSessionLine(paidDraft, facts);
  });
}
