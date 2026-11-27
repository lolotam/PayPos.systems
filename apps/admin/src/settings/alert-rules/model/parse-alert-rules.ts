import { alertKind, alertRules, type AlertRules } from '@pospay/contracts';

// خادم أحدث ممكن يضيف نوع تنبيه جديد؛ حزمة إدارة أقدم تتجاهله بدل ما تفشل الشاشة كلها (issue #938).
// بيتجاهل بس مدخل نوعه نص غير معروف؛ المدخل بلا نوع أو بنوع مش نص بيعدّي للعقد الصارم فيترفض.
export function parseAlertRules(data: unknown): AlertRules {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('rules' in data) ||
    !Array.isArray(data.rules)
  ) {
    return alertRules.parse(data);
  }
  const known = data.rules.filter(
    (entry: unknown) =>
      !(
        typeof entry === 'object' &&
        entry !== null &&
        'kind' in entry &&
        typeof entry.kind === 'string' &&
        !alertKind.safeParse(entry.kind).success
      ),
  );
  return alertRules.parse({ ...data, rules: known });
}
