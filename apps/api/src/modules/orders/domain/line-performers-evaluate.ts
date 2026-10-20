import {
  assertChangerIsNotPerformer,
  type LinePerformersIdentity,
} from './line-performers-identity.ts';
import {
  prepareLinePerformersChange,
  type PrepareLinePerformersInput,
  type PreparedLinePerformersChange,
} from './line-performers-prepare.ts';

/** حقائق محمّلة قبل الحكم؛ السلطة ونطاق المسار ليسا منها. */
export interface LinePerformersFacts {
  actor_user_id: string;
  identities: LinePerformersIdentity;
  preparation: PrepareLinePerformersInput;
}

/**
 * يطبّق ترتيب رفض FR-011 على حقائق محمّلة سلفاً، من هوية المنفّذة حتى قاعدة «لا تغيير».
 * السلطة ونطاق المسار يبقيان في الحارس وحالة الاستخدام؛ هذه الدالة لا تعيد فحص الصلاحية ولا تطابق الفرع.
 * اختيار عضوية التغيير يسبقها عبر resolveSessionChanger لأنه ليس من قائمة FR-011.
 *
 * @param facts هوية المستخدمة ومنفّذات السطر ومدخلات التجهيز
 * @returns نتيجة التجهيز بعد قبول الهوية
 */
export function evaluateLinePerformersChange(facts: LinePerformersFacts): PreparedLinePerformersChange {
  assertChangerIsNotPerformer(facts.actor_user_id, facts.identities);
  return prepareLinePerformersChange(facts.preparation);
}
