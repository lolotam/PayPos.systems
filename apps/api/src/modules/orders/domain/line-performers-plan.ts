import { SessionError } from './session-error.ts';
import { performerWarnings } from './session-performers.ts';
import type { SessionEmployee } from './session-types.ts';

/** صف منفّذة على السطر كما يُحفظ: هويتها واسمها ونسبتها وتنبيهاتها. */
export interface LinePerformerRow {
  employee_id: string;
  performer_ordinal: number;
  share_bps: number;
  name_en: string;
  name_ar: string | null;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
  not_clocked_in_warning: boolean;
  approved_leave_warning: boolean;
}

/** موظفة مطلوبة بنسبتها النهائية بعد التحقق. */
export interface RequestedPerformer {
  employee_id: string;
  share_bps: number;
}

/** مدخلات إعادة كتابة المجموعة: ما هو محفوظ الآن وما هو مطلوب ومن أُضيف. */
export interface LinePerformersPlanInput {
  current: readonly LinePerformerRow[];
  requested: readonly RequestedPerformer[];
  added_employees: readonly SessionEmployee[];
}

/** خطة المجموعة الجديدة: الصفوف بعد التغيير ومن بقي ومن راح ومن أُضيف. */
export interface LinePerformersPlan {
  after: LinePerformerRow[];
  kept_ids: string[];
  removed_ids: string[];
  added_ids: string[];
  has_performer_warning: boolean;
}

/**
 * يبني إعادة كتابة مجموعة المنفّذات: مجموعة جديدة كاملة بترتيب الطلب، ترتيبها 1..n.
 * المنفّذة الباقية تنسخ اسمها وهويتها وتنبيهاتها من صفها القديم ولا تُقرأ من جديد، فلقطة التسجيل تبقى كما هي.
 * المنفّذة المضافة تأخذ اسمها من حقائق الموظفة وربطها الحالي لحظة التغيير، وتنبيهاتها من وقتها هي.
 * شرط مسبق: الموظفات المضافات تحققت من الأهلية قبل هذه الدالة، ومعرّفات الطلب بلا تكرار.
 *
 * @param input الصفوف الحالية والمطلوبة وحقائق الموظفات المضافات
 * @returns الصفوف الجديدة ومن بقي ومن راح ومن أُضيف وراية السطر
 */
export function planPerformersChange(input: LinePerformersPlanInput): LinePerformersPlan {
  const currentById = new Map(input.current.map((row) => [row.employee_id, row]));
  const after: LinePerformerRow[] = [];
  const kept_ids: string[] = [];
  const added_ids: string[] = [];
  input.requested.forEach((requested, index) => {
    const old = currentById.get(requested.employee_id);
    if (old !== undefined) {
      kept_ids.push(old.employee_id);
      after.push({
        ...old,
        performer_ordinal: index + 1,
        share_bps: requested.share_bps,
      });
      return;
    }
    const employee = input.added_employees.find((candidate) => candidate.id === requested.employee_id);
    if (employee === undefined) {
      throw new SessionError('SESSION_PERFORMER_NOT_ELIGIBLE', { employee_ids: [requested.employee_id] });
    }
    const warnings = performerWarnings(employee);
    added_ids.push(employee.id);
    after.push({
      employee_id: employee.id,
      performer_ordinal: index + 1,
      share_bps: requested.share_bps,
      name_en: employee.name_en,
      name_ar: employee.name_ar,
      linked_user_id: employee.user_id,
      linked_user_snapshotted: true,
      not_clocked_in_warning: warnings.not_clocked_in_warning,
      approved_leave_warning: warnings.approved_leave_warning,
    });
  });
  const requestedIds = new Set(input.requested.map((requested) => requested.employee_id));
  const removed_ids = [...input.current]
    .sort((left, right) => left.performer_ordinal - right.performer_ordinal)
    .filter((row) => !requestedIds.has(row.employee_id))
    .map((row) => row.employee_id);
  const has_performer_warning = after.some(
    (row) => row.not_clocked_in_warning || row.approved_leave_warning,
  );
  return { after, kept_ids, removed_ids, added_ids, has_performer_warning };
}

/**
 * يقول إن المجموعة المطلوبة هي نفسها المحفوظة: نفس الموظفات بنفس النسب، والترتيب لا يهم.
 * إعادة الترتيب وحدها ليست تغييراً تستهلك نسخة، لأن ما يراه القارئ لم يتغيّر.
 * شرط مسبق: معرّفات المجموعتين بلا تكرار، فقد قُبلت قاعدة النسب قبل هذا الفحص.
 *
 * @param current الصفوف المحفوظة الآن
 * @param requested الصفوف المطلوبة بعد التحقق من النسب
 * @returns هل المجموعة واحدة بلا اعتبار الترتيب
 */
export function isSamePerformerSet(
  current: readonly { employee_id: string; share_bps: number }[],
  requested: readonly { employee_id: string; share_bps: number }[],
): boolean {
  if (current.length !== requested.length) return false;
  const shares = new Map(current.map((row) => [row.employee_id, row.share_bps]));
  return requested.every((row) => shares.get(row.employee_id) === row.share_bps);
}
