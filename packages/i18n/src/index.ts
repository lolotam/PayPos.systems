export {
  errorMessages,
  t,
  type Catalog,
  type ErrorMessageCode,
  type Locale,
  type MessageKey,
} from './catalog.js';
export { formatDate, formatTime, isTimeZone, localDate, type CalendarSystem } from './dates.js';
// قسم عناوين بيان الحضور: مصدر الـ worker بيقارن مفاتيحه بمفاتيح العقد، فمحتاج الوصول للقسم.
export { attendanceStatementAr, attendanceStatementEn } from './attendance-statement-catalog.js';
export { commissionStatementAr, commissionStatementEn } from './commission-statement-catalog.js';
export { formatKwd } from './format-kwd.js';
export { normalizeKwdInput } from './kwd-input.js';
export { formatInstant } from './format-instant.js';
export { roleName } from './role-name.js';
export { safeDisplayName } from './display-name.js';
export { editorLabel, type EditorLabelSnapshot } from './editor-label.js';
export { formatRemainingMinutes } from './remaining-minutes.js';
export { permissionName } from './permission-name.js';
export { serviceSessionErrors, type ServiceSessionErrorCode } from './service-session-errors.js';
export {
  discountApprovalRefusals,
  type DiscountApprovalRefusalCode,
} from './discount-approval-errors.js';
export {
  attendanceStatementErrorsEn,
  attendanceStatementErrorsAr,
  attendanceStatementRenderErrors,
} from './attendance-statement-errors.js';
export { commissionStatementRenderErrors } from './commission-statement-errors.js';
