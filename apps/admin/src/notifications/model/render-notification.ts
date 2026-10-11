import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';

/** نص الجرس. generic_notice يبقى على locale الصف؛ تنبيهات الحضور تتبع لغة الواجهة، والعربي الغائب يرجع للإنجليزي. */
export function renderNotification(item: InAppNotification, viewerLocale?: Locale): string {
  if (
    item.template_key === 'attendance_change_requested' ||
    item.template_key === 'attendance_change_decided'
  ) {
    const locale = viewerLocale ?? item.locale;
    const values = Object.fromEntries(item.safe_parameters.map((p) => [p.name, p.value]));
    values['change'] = t(
      locale,
      values['change'] === 'ADD_SESSION'
        ? 'inApp.attendance_change_add'
        : 'inApp.attendance_change_void',
    );
    values['decision'] = t(
      locale,
      values['decision'] === 'APPROVED'
        ? 'inApp.attendance_change_approved'
        : 'inApp.attendance_change_rejected',
    );
    return fill(t(locale, `inApp.${item.template_key}`), values);
  }
  if (item.template_key === 'shift_not_clocked_in') {
    const locale = viewerLocale ?? item.locale;
    return fill(t(locale, 'inApp.shift_not_clocked_in'), shiftValues(item.safe_parameters));
  }
  if (item.template_key === 'break_not_returned') {
    const locale = viewerLocale ?? item.locale;
    return fill(t(locale, 'inApp.break_not_returned'), shiftValues(item.safe_parameters));
  }
  return fill(
    t(item.locale, 'inApp.generic_notice'),
    Object.fromEntries(item.safe_parameters.map((parameter) => [parameter.name, parameter.value])),
  );
}

function shiftValues(parameters: InAppNotification['safe_parameters']): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const employeeEn = read('employee_name_en');
  const branchEn = read('branch_name_en');
  const employeeAr = read('employee_name_ar').trim();
  const branchAr = read('branch_name_ar').trim();
  return {
    employee_name_en: employeeEn,
    employee_name_ar: employeeAr.length > 0 ? employeeAr : employeeEn,
    branch_name_en: branchEn,
    branch_name_ar: branchAr.length > 0 ? branchAr : branchEn,
    shift_start: read('shift_start'),
    break_end: read('break_end'),
  };
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(
    /\{\{([a-z_]+)\}\}/g,
    (placeholder, name: string) => values[name] ?? placeholder,
  );
}
