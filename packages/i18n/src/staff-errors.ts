import {
  attendanceStatementErrorsAr,
  attendanceStatementErrorsEn,
} from './attendance-statement-errors.js';
import { privateViewErrorsAr, privateViewErrorsEn } from './private-view-errors.js';
import { staffColumnsErrorsAr, staffColumnsErrorsEn } from './staff-columns-errors.js';

export const staffErrorsEn = {
  ...staffColumnsErrorsEn,
  ...attendanceStatementErrorsEn,
  ...privateViewErrorsEn,
  STAFF_ACCESS_PENDING_BRANCH_CHANGE:
    'The primary branch cannot change while a staff access grant or cancellation is in progress for this employee.',
  PIN_CHANGE_REQUIRED:
    'This PIN is temporary. Change it before you sign in.',
  PIN_EXPIRED:
    'This temporary PIN has expired. Ask your manager for a new one.',
};

export const staffErrorsAr = {
  ...staffColumnsErrorsAr,
  ...attendanceStatementErrorsAr,
  ...privateViewErrorsAr,
  STAFF_ACCESS_PENDING_BRANCH_CHANGE:
    'ما ينفعش تغيّر الفرع الأساسي دلوقتي؛ فيه عملية إعطاء دخول أو إلغاء قيد التنفيذ للموظفة دي.',
  PIN_CHANGE_REQUIRED: 'الرقم السري ده مؤقت؛ غيّره قبل ما تدخل.',
  PIN_EXPIRED: 'الرقم السري المؤقت خلصت مدته؛ اطلب من مديرك رقماً جديداً.',
};
