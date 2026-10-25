import {
  attendanceStatementErrorsAr,
  attendanceStatementErrorsEn,
} from './attendance-statement-errors.js';
import { staffColumnsErrorsAr, staffColumnsErrorsEn } from './staff-columns-errors.js';

export const staffErrorsEn = {
  ...staffColumnsErrorsEn,
  ...attendanceStatementErrorsEn,
};

export const staffErrorsAr = {
  ...staffColumnsErrorsAr,
  ...attendanceStatementErrorsAr,
};
