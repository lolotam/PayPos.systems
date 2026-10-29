import { attendanceStatementAr, attendanceStatementEn } from './attendance-statement-catalog.js';
import {
  attendanceStatementScreenAr,
  attendanceStatementScreenEn,
} from './attendance-statement-screen-catalog.js';
import {
  companyEmployeeNumbersAr,
  companyEmployeeNumbersEn,
} from './company-employee-numbers-catalog.js';
import { employeeAppLinkAr, employeeAppLinkEn } from './employee-app-link-catalog.js';
import { employeeImportAr, employeeImportEn } from './employee-import.js';

/** كتالوجات شاشات منطقة الموظفين مجمعة عشان en.ts وar.ts يفضلوا تحت حد عدد السطور. */
export const staffScreensEn = {
  attendanceStatement: attendanceStatementEn,
  attendanceStatementScreen: attendanceStatementScreenEn,
  companyEmployeeNumbers: companyEmployeeNumbersEn,
  employeeAppLink: employeeAppLinkEn,
  employeeImport: employeeImportEn,
};

/** نفس المفاتيح بالعربي. */
export const staffScreensAr = {
  attendanceStatement: attendanceStatementAr,
  attendanceStatementScreen: attendanceStatementScreenAr,
  companyEmployeeNumbers: companyEmployeeNumbersAr,
  employeeAppLink: employeeAppLinkAr,
  employeeImport: employeeImportAr,
};
