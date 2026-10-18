import type { LineEditPerformer } from './line-edit-identity.ts';
import { assertCancellerIsNotPerformer } from './line-cancel-identity.ts';
import {
  prepareLineCancel,
  type PrepareLineCancelInput,
  type PreparedLineCancel,
} from './line-cancel-prepare.ts';

/** حقائق محمّلة قبل الحكم؛ السلطة ونطاق المسار ليسا منها. */
export interface LineCancelFacts {
  actor_user_id: string;
  performers: readonly LineEditPerformer[];
  preparation: PrepareLineCancelInput;
}

/**
 * يطبّق ترتيب رفض FR-011 على حقائق محمّلة سلفاً، من هوية المنفّذة حتى حارس البقشيش.
 * السلطة ونطاق المسار يبقيان في الحارس وحالة الاستخدام؛ هذه الدالة لا تعيد فحص الصلاحية ولا تطابق الفرع.
 * اختيار عضوية الإلغاء يسبقها عبر resolveSessionCanceller لأنه ليس من قائمة FR-011.
 *
 * @param facts هوية المستخدمة ومنفّذات السطر ومدخلات التجهيز
 * @returns نتيجة التجهيز بعد قبول الهوية
 */
export function evaluateLineCancel(facts: LineCancelFacts): PreparedLineCancel {
  assertCancellerIsNotPerformer(facts.actor_user_id, facts.performers);
  return prepareLineCancel(facts.preparation);
}
