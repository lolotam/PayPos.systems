import { cancelBlockedByTip, type CancelTipLine } from './line-cancel-tip.ts';
import { normalizeCancelReason } from './line-cancel-reason.ts';
import { SessionError } from './session-error.ts';
import { validateAppendWindow } from './session-time.ts';

/** حالة السطر المحمّلة؛ العلامة محجوزة لصفوف 42/43 ولم تُستنتج من حقل آخر. */
export interface CancelLineState {
  status: 'ACTIVE' | 'CANCELLED';
  revision: number;
  price: bigint;
  discount: bigint;
  net: bigint;
  not_cancellable: boolean;
}

/** نتيجة مقبولة؛ الأرقام السابقة هي أرقام السطر نفسها بلا إعادة حساب. */
export interface PreparedLineCancel {
  status: 'CANCELLED';
  revision: number;
  previous: { revision: number; price: bigint; discount: bigint; net: bigint };
}

/** حقائق التجهيز بعد التحميل؛ النافذة تُفحص بالساعة المحقونة لا بساعة الجهاز. */
export interface PrepareLineCancelInput {
  line: CancelLineState;
  expected_revision: number;
  business_date: string;
  now: Date;
  business_timezone: string;
  reason: string | undefined;
  line_id: string;
  active_lines: readonly CancelTipLine[];
  performers_by_line: ReadonlyMap<string, readonly string[]>;
  current_tip_employee_ids: readonly string[];
}

/**
 * يجهّز إلغاء السطر من غير أن يغيّر سعره أو خصمه أو صافيه.
 * السبب يُفحص ثم يُهمل لأن الناتج لا يحمله؛ من يحفظ النص يستدعي normalizeCancelReason مرة ثانية.
 * ترتيب الرفض هنا هو ذيل FR-011: النسخة، ثم الإلغاء السابق، ثم العلامة المحجوزة، ثم النافذة، ثم السبب، ثم البقشيش.
 * علامة not_cancellable مدخل فقط؛ صفوف 42/43 لم تضفها بعد والمستدعي يمرّر false، ولا شرط آخر يُخترع هنا.
 *
 * @param input السطر المحمّل والنسخة المتوقعة والنافذة والسبب وحقائق البقشيش
 * @returns الحالة CANCELLED والنسخة التالية والأرقام السابقة كما هي
 */
export function prepareLineCancel(input: PrepareLineCancelInput): PreparedLineCancel {
  if (input.line.revision !== input.expected_revision) {
    throw new SessionError('SESSION_LINE_REVISION_STALE', {
      current_revision: input.line.revision,
    });
  }
  if (input.line.status === 'CANCELLED') throw new SessionError('SESSION_LINE_ALREADY_CANCELLED');
  if (input.line.not_cancellable) throw new SessionError('SESSION_LINE_NOT_CANCELLABLE');
  validateAppendWindow(input.business_date, input.now, input.business_timezone);
  normalizeCancelReason(input.reason);
  const employeeIds = cancelBlockedByTip(
    input.line_id,
    input.active_lines,
    input.performers_by_line,
    input.current_tip_employee_ids,
  );
  if (employeeIds.length > 0) {
    throw new SessionError('SESSION_CANCEL_BLOCKED_BY_TIP', { employee_ids: employeeIds });
  }
  return {
    status: 'CANCELLED',
    revision: input.line.revision + 1,
    previous: {
      revision: input.line.revision,
      price: input.line.price,
      discount: input.line.discount,
      net: input.line.net,
    },
  };
}
