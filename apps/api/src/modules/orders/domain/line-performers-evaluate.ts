import type { LineEditPerformer } from './line-edit-identity.ts';
import {
  assertChangerIsNotPerformer,
  requestedPerformerIdentities,
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
  assertChangerIsNotPerformer(
    facts.actor_user_id,
    facts.identities,
    addedPerformerIdentities(facts.preparation),
  );
  return prepareLinePerformersChange(facts.preparation);
}

/**
 * يشتق هوية المنفّذات المضافات من حقائق الموظفات المضافات نفسها التي تُحفظ في الصفوف الجديدة.
 * مصدر واحد للربط: ما يُفحص في قاعدة «لا تكتب على سطرك» هو ما يُحفظ، فلا يتفرقان.
 * الباقيات مشمولات بالفعل في الهوية الحالية، فلا تُشتق لهن لقطة ثانية.
 *
 * @param preparation حقائق التجهيز المحمّلة
 * @returns هوية كل موظفة مضافة في الطلب
 */
function addedPerformerIdentities(preparation: PrepareLinePerformersInput): LineEditPerformer[] {
  const currentIds = new Set(preparation.current_performers.map((row) => row.employee_id));
  const addedIds = preparation.requested_performers
    .map((performer) => performer.employee_id)
    .filter((employeeId) => !currentIds.has(employeeId));
  return requestedPerformerIdentities(addedIds, preparation.added_employees);
}
