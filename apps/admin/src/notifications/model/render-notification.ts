import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';

/** نص الجرس. generic_notice يبقى على locale الصف؛ تنبيهات الحضور والجلسات وتعديل السعر والإلغاء وتغيير المنفّذين وطلب موافقة الخصم وموافقة المنفّذ تتبع لغة الواجهة، والعربي الغائب يرجع للإنجليزي. */
export function renderNotification(item: InAppNotification, viewerLocale?: Locale): string {
  const serviceLine = renderServiceLineNotice(item, viewerLocale);
  if (serviceLine !== null) return serviceLine;
  if (
    item.template_key === 'discount_approval_requested' ||
    item.template_key === 'discount_approved_by_performer'
  ) {
    return fill(
      t(viewerLocale ?? item.locale, `inApp.${item.template_key}`),
      discountApprovalValues(item.safe_parameters),
    );
  }
  if (item.template_key === 'late_service_session') {
    const values = Object.fromEntries(
      item.safe_parameters.map((parameter) => [parameter.name, parameter.value]),
    );
    values['branch_name_ar'] = values['branch_name_ar']?.trim() || values['branch_name_en'] || '';
    return fill(t(viewerLocale ?? item.locale, 'inApp.late_service_session'), values);
  }
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
        : values['change'] === 'RESTORE_SESSION'
          ? 'inApp.attendance_change_restore'
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
  if (item.template_key === 'break_returned_other_branch') {
    const locale = viewerLocale ?? item.locale;
    return fill(t(locale, 'inApp.break_returned_other_branch'), shiftValues(item.safe_parameters));
  }
  return fill(
    t(item.locale, 'inApp.generic_notice'),
    Object.fromEntries(item.safe_parameters.map((parameter) => [parameter.name, parameter.value])),
  );
}

function renderServiceLineNotice(item: InAppNotification, viewerLocale?: Locale): string | null {
  if (item.template_key === 'service_line_price_edited') {
    return fill(
      t(viewerLocale ?? item.locale, 'inApp.service_line_price_edited'),
      priceEditValues(item.safe_parameters),
    );
  }
  if (item.template_key === 'service_line_cancelled') {
    return fill(
      t(viewerLocale ?? item.locale, 'inApp.service_line_cancelled'),
      cancelledLineValues(item.safe_parameters),
    );
  }
  if (item.template_key === 'service_line_performers_changed') {
    return fill(
      t(viewerLocale ?? item.locale, 'inApp.service_line_performers_changed'),
      performersChangedValues(item.safe_parameters),
    );
  }
  return null;
}

function priceEditValues(parameters: InAppNotification['safe_parameters']): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const serviceEn = read('service_name_en');
  const branchEn = read('branch_name_en');
  const editorEn = read('editor_name_en');
  return {
    service_name_en: serviceEn,
    service_name_ar: arabic('service_name_ar', serviceEn),
    branch_name_en: branchEn,
    branch_name_ar: arabic('branch_name_ar', branchEn),
    editor_name_en: editorEn,
    editor_name_ar: arabic('editor_name_ar', editorEn),
    business_date: read('business_date'),
    previous_net: read('previous_net'),
    new_net: read('new_net'),
  };
}

function cancelledLineValues(
  parameters: InAppNotification['safe_parameters'],
): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const serviceEn = read('service_name_en');
  const branchEn = read('branch_name_en');
  return {
    service_name_en: serviceEn,
    service_name_ar: arabic('service_name_ar', serviceEn),
    branch_name_en: branchEn,
    branch_name_ar: arabic('branch_name_ar', branchEn),
    business_date: read('business_date'),
    cancelled_net: read('cancelled_net'),
  };
}

function performersChangedValues(
  parameters: InAppNotification['safe_parameters'],
): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const serviceEn = read('service_name_en');
  const branchEn = read('branch_name_en');
  return {
    service_name_en: serviceEn,
    service_name_ar: arabic('service_name_ar', serviceEn),
    branch_name_en: branchEn,
    branch_name_ar: arabic('branch_name_ar', branchEn),
    business_date: read('business_date'),
    line_net: read('line_net'),
  };
}

function discountApprovalValues(
  parameters: InAppNotification['safe_parameters'],
): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const values: Record<string, string> = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.value]),
  );
  for (const name of ['branch_name', 'service_name', 'approver_name']) {
    values[`${name}_ar`] = arabic(`${name}_ar`, read(`${name}_en`));
  }
  return values;
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
