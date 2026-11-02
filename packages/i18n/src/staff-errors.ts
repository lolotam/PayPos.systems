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
};

export const staffErrorsAr = {
  ...staffColumnsErrorsAr,
  ...attendanceStatementErrorsAr,
  ...privateViewErrorsAr,
};
