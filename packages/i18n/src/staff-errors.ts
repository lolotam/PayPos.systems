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
};

export const staffErrorsAr = {
  ...staffColumnsErrorsAr,
  ...attendanceStatementErrorsAr,
  ...privateViewErrorsAr,
  STAFF_ACCESS_PENDING_BRANCH_CHANGE:
    'ما ينفعش تغيّر الفرع الأساسي دلوقتي؛ فيه عملية إعطاء دخول أو إلغاء قيد التنفيذ للموظفة دي.',
};
