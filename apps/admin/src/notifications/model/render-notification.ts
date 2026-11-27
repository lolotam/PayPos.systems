import type { InAppNotification } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { documentNumberText } from '@/shared/model/document-number-text';
import {
  isLowRatingNotice,
  renderLowRatingNotice,
  type ScalarNotification,
} from './low-rating-notice';

// معاملات الجرس القديمة كلها نصوص؛ جرسا التقييم المنخفض معاملهما كائن details وبيتعرضوا في ملفهم.
type ScalarParameters = ScalarNotification['safe_parameters'];

/** نص الجرس. generic_notice يبقى على locale الصف؛ تنبيهات الحضور والجلسات وتعديل السعر والإلغاء وتغيير المنفّذين وطلب موافقة الخصم وموافقة المنفّذ وجرس استرداد الباقة وتوقف تصحيح العمولة تتبع لغة الواجهة، والعربي الغائب يرجع للإنجليزي. */
export function renderNotification(
  item: InAppNotification,
  viewerLocale?: Locale,
  documentNumber?: string,
): string {
  if (isLowRatingNotice(item)) return renderLowRatingNotice(item, viewerLocale ?? item.locale);
  const serviceLine = renderServiceLineNotice(item, viewerLocale);
  if (serviceLine !== null) return serviceLine;
  if (
    item.template_key === 'package_refund_recorded' ||
    item.template_key === 'discount_approval_requested' ||
    item.template_key === 'discount_self_approved'
  ) {
    return fill(
      t(viewerLocale ?? item.locale, `inApp.${item.template_key}`),
      discountApprovalValues(item.safe_parameters),
    );
  }
  if (
    item.template_key === 'commission_correction_blocked' ||
    item.template_key === 'statement_awaiting_approval' ||
    item.template_key === 'statement_awaiting_review'
  ) {
    return renderPeriodNotice(item, viewerLocale);
  }
  if (item.template_key === 'commission_event_parked') {
    return renderParkedEventNotice(item, viewerLocale);
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
    return renderAttendanceChange(item, viewerLocale);
  }
  if (
    item.template_key === 'shift_not_clocked_in' ||
    item.template_key === 'break_not_returned' ||
    item.template_key === 'break_returned_other_branch'
  ) {
    return fill(
      t(viewerLocale ?? item.locale, `inApp.${item.template_key}`),
      shiftValues(item.safe_parameters),
    );
  }
  if (isStaffAlert(item)) return renderStaffAlert(item, viewerLocale, documentNumber);
  return fill(
    t(item.locale, 'inApp.generic_notice'),
    Object.fromEntries(item.safe_parameters.map((parameter) => [parameter.name, parameter.value])),
  );
}

/** جرسا الحضور والمستند ووصول الدخول: كلها بلغة الواجهة، والعربي الغائب يرجع للإنجليزي. */
function isStaffAlert(item: ScalarNotification): boolean {
  return (
    item.template_key === 'attendance_exception_raised' ||
    item.template_key === 'document_expiring' ||
    item.template_key === 'staff_access_granted' ||
    item.template_key === 'staff_pin_set_by_other' ||
    item.template_key === 'staff_pin_recovered'
  );
}

/** جرس ياخد معامل واحد بس: الشهر (توقف تصحيح العمولة، اعتماد كشف العمولة). */
function renderPeriodNotice(item: ScalarNotification, viewerLocale?: Locale): string {
  return fill(
    t(viewerLocale ?? item.locale, `inApp.${item.template_key}`),
    Object.fromEntries(item.safe_parameters.map((parameter) => [parameter.name, parameter.value])),
  );
}

/** جرس الحدث الموقوف: نوع الحدث ورقمه المرجعي، وتبقى لغة الواجهة. */
function renderParkedEventNotice(item: ScalarNotification, viewerLocale?: Locale): string {
  return fill(
    t(viewerLocale ?? item.locale, 'inApp.commission_event_parked'),
    Object.fromEntries(item.safe_parameters.map((parameter) => [parameter.name, parameter.value])),
  );
}

/** طلبات تعديل الحضور وقراراتها: التغيير والقرار بيتقروا بلغة الواجهة. */
function renderAttendanceChange(item: ScalarNotification, viewerLocale?: Locale): string {
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

export type DocumentNumbersByBusiness = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** معرف المستند من المعاملات الآمنة؛ يبقى خارج النص ولا يُستخدم إلا كمفتاح للقراءة الموثقة. */
export function documentIdOf(item: InAppNotification): string | null {
  if (isLowRatingNotice(item)) return null;
  return item.safe_parameters.find((parameter) => parameter.name === 'document_id')?.value ?? null;
}

/** جرسا استثناء الحضور وانتهاء المستند وجرسا وصول الدخول: لغة الواجهة، والعربي الغائب يرجع للإنجليزي، ومعرّف المستند ما يظهرش؛ رقم المستند الحالي فقط إذا وصل من القراءة الموثقة. */
function renderStaffAlert(
  item: ScalarNotification,
  viewerLocale?: Locale,
  documentNumber?: string,
): string {
  const locale = viewerLocale ?? item.locale;
  const values = staffAlertValues(item.safe_parameters);
  const number =
    item.template_key === 'document_expiring' ? documentNumberText(documentNumber) : undefined;
  if (number !== undefined) values['document_number'] = `\u2068${number}\u2069`;
  return fill(
    t(
      locale,
      number !== undefined ? 'inApp.document_expiring_numbered' : `inApp.${item.template_key}`,
    ),
    values,
  );
}

function renderServiceLineNotice(item: ScalarNotification, viewerLocale?: Locale): string | null {
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

function priceEditValues(parameters: ScalarParameters): Record<string, string> {
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

function cancelledLineValues(parameters: ScalarParameters): Record<string, string> {
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

function performersChangedValues(parameters: ScalarParameters): Record<string, string> {
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

function discountApprovalValues(parameters: ScalarParameters): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const values: Record<string, string> = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.value]),
  );
  for (const name of ['branch_name', 'service_name', 'package_name', 'approver_name']) {
    if (read(`${name}_en`) || read(`${name}_ar`)) {
      values[`${name}_ar`] = arabic(`${name}_ar`, read(`${name}_en`));
    }
  }
  return values;
}

function shiftValues(parameters: ScalarParameters): Record<string, string> {
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

/** قيم جرسَي الاستثناء والمستند ووصول الدخول: العربي الغائب يرجع للإنجليزي، ومعرّف المستند ما بيتبعتش للنص. */
function staffAlertValues(parameters: ScalarParameters): Record<string, string> {
  const read = (name: string) => parameters.find((item) => item.name === name)?.value ?? '';
  const arabic = (name: string, english: string) => {
    const value = read(name).trim();
    return value.length > 0 ? value : english;
  };
  const values: Record<string, string> = {};
  for (const parameter of parameters)
    if (parameter.name !== 'document_id') values[parameter.name] = parameter.value;
  for (const name of ['employee_name', 'actor_name', 'branch_name', 'document_type']) {
    values[`${name}_ar`] = arabic(`${name}_ar`, read(`${name}_en`));
  }
  return values;
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(
    /\{\{([a-z_]+)\}\}/g,
    (placeholder, name: string) => values[name] ?? placeholder,
  );
}
