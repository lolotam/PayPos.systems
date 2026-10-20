import { assertLineEditable } from './line-edit-prepare.ts';
import {
  isSamePerformerSet,
  planPerformersChange,
  type LinePerformerRow,
} from './line-performers-plan.ts';
import { normalizePerformersReason } from './line-performers-reason.ts';
import { SessionError } from './session-error.ts';
import { validateShares } from './session-performers.ts';
import { validateAppendWindow } from './session-time.ts';
import type { SessionEmployee } from './session-types.ts';

/** حالة السطر المحمّلة؛ العلامة محجوزة لصفوف 42/43 ولم تُستنتج من حقل آخر. */
export interface PerformersLineState {
  status: 'ACTIVE' | 'CANCELLED';
  revision: number;
  not_changeable: boolean;
}

/** حقائق التجهيز بعد التحميل؛ النافذة تُفحص بالساعة المحقونة لا بساعة الجهاز. */
export interface PrepareLinePerformersInput {
  line: PerformersLineState;
  expected_revision: number;
  business_date: string;
  now: Date;
  business_timezone: string;
  reason: string | undefined;
  current_performers: readonly LinePerformerRow[];
  requested_performers: readonly { employee_id: string; share_bps?: number | undefined }[];
  added_employees: readonly SessionEmployee[];
}

/** نتيجة مقبولة؛ الأرقام السابقة هي أرقام السطر نفسها بلا إعادة حساب. */
export interface PreparedLinePerformersChange {
  revision: number;
  reason: string;
  previous: { revision: number; performers: { employee_id: string; share_bps: number }[] };
  after: LinePerformerRow[];
  kept_ids: string[];
  removed_ids: string[];
  added_ids: string[];
  has_performer_warning: boolean;
}

/**
 * يجهّز تغيير منفّذات السطر من غير أن يغيّر سعره أو خصمه أو صافيه.
 * ترتيب الرفض هنا هو ذيل FR-011: النسخة، ثم الإلغاء السابق، ثم العلامة المحجوزة، ثم النافذة، ثم السبب،
 * ثم شكل المجموعة، ثم أهلية المضافات، ثم «لا تغيير».
 * المنفّذة الباقية لا يُعاد فحصها (D-11): مدير يصلّح نسبة زميلة لا يُجبر على تشيل من سابت.
 * علامة not_changeable مدخل فقط؛ صفوف 42/43 لم تضفها بعد والمستدعي يمرّر false، ولا شرط آخر يُخترع هنا.
 *
 * @param input السطر المحمّل والنسخة المتوقعة والنافذة والسبب ومنفّذات السطر والمطلوب وحقائق المضافات
 * @returns النسخة التالية والسبب والسابق والصفوف الجديدة ومن بقي ومن راح ومن أُضيف
 */
export function prepareLinePerformersChange(
  input: PrepareLinePerformersInput,
): PreparedLinePerformersChange {
  assertLineEditable(input.line, input.expected_revision);
  if (input.line.not_changeable) throw new SessionError('SESSION_LINE_PERFORMERS_NOT_CHANGEABLE');
  validateAppendWindow(input.business_date, input.now, input.business_timezone);
  const reason = normalizePerformersReason(input.reason);
  const requested = requestedWithShares(input.requested_performers);
  refuseIneligibleAdditions(input, requested);
  if (isSamePerformerSet(input.current_performers, requested)) {
    throw new SessionError('SESSION_PERFORMERS_NO_CHANGE');
  }
  const plan = planPerformersChange({
    current: input.current_performers,
    requested,
    added_employees: input.added_employees,
  });
  return {
    revision: input.line.revision + 1,
    reason,
    previous: {
      revision: input.line.revision,
      performers: previousPerformers(input.current_performers),
    },
    after: plan.after,
    kept_ids: plan.kept_ids,
    removed_ids: plan.removed_ids,
    added_ids: plan.added_ids,
    has_performer_warning: plan.has_performer_warning,
  };
}

/**
 * يربط كل موظفة مطلوبة بنسبتها بعد فحص قاعدة SS-20، ويخفي موضع البند من تفاصيل الرفض.
 * السطر في هذا الطلب واحد، ورقم البند لا يوجّه تصحيحاً؛ الرفض يحمل الرمز وحده.
 *
 * @param requested الموظفات المطلوبات بنسبهن الاختيارية
 * @returns الموظفات المطلوبات بنسبهن النهائية
 */
function requestedWithShares(
  requested: readonly { employee_id: string; share_bps?: number | undefined }[],
): { employee_id: string; share_bps: number }[] {
  let shares: number[];
  try {
    shares = validateShares(requested, 0);
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_PERFORMER_SHARES_INVALID') {
      throw new SessionError('SESSION_PERFORMER_SHARES_INVALID');
    }
    throw error;
  }
  return requested.map((performer, index) => ({
    employee_id: performer.employee_id,
    share_bps: shares[index] as number,
  }));
}

/**
 * يرفض الموظفات المضافات غير المؤهلة، ولا يمس الباقيات مهما كانت حالتهن الآن.
 * الموظفة الناقصة من حقائقها تُعدّ غير مؤهلة، فالغياب لا يُخمَّن تأهيلاً.
 *
 * @param input حقائق التجهيز كلها
 * @param requested الموظفات المطلوبات بنسبهن النهائية
 * @returns لا شيء؛ أي موظفة مضافة غير مؤهلة ترفض الطلب كله
 */
function refuseIneligibleAdditions(
  input: PrepareLinePerformersInput,
  requested: readonly { employee_id: string }[],
): void {
  const currentIds = new Set(input.current_performers.map((row) => row.employee_id));
  const employee_ids = requested
    .filter((performer) => !currentIds.has(performer.employee_id))
    .filter((performer) => {
      const employee = input.added_employees.find((candidate) => candidate.id === performer.employee_id);
      return employee === undefined || employee.eligible === false;
    })
    .map((performer) => performer.employee_id);
  if (employee_ids.length > 0) {
    throw new SessionError('SESSION_PERFORMER_NOT_ELIGIBLE', { employee_ids });
  }
}

/**
 * يقرأ المنفّذات المحفوظة بترتيبهن القديم، لأن تاريخ السطر يُقرأ بترتيب المنفّذة لا بترتيب الطلب.
 *
 * @param current صفوف المنفّذات المحفوظة الآن
 * @returns الموظفات ونسبهن بترتيب السطر القديم
 */
function previousPerformers(current: readonly LinePerformerRow[]): { employee_id: string; share_bps: number }[] {
  return [...current]
    .sort((left, right) => left.performer_ordinal - right.performer_ordinal)
    .map((row) => ({ employee_id: row.employee_id, share_bps: row.share_bps }));
}
