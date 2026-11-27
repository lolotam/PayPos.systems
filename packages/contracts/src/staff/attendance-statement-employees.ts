import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { employeeDate } from './employee.js';

/**
 * فترة منتقي الموظفات: أول وآخر يوم عمل محلي للفرع.
 * الشكل بس؛ ترتيب التاريخين وسقف الـ366 يوم وسقف الشهر كلهم في فحص الخادم
 * `statementPeriodIsValid` عشان الرفض يطلع 422 مش 400 (زي رفض فترة الطلب نفسها).
 */
export const attendanceStatementEmployeesQuery = z.strictObject({
  from: employeeDate,
  to: employeeDate,
});

/**
 * موظفات الفرع اللي ليها تغطية في الفترة: معرّف الموظفة واسمها بالعربي والإنجليزي ورقمها.
 * الأرقام دي بتتظبط في السجلات لا في البيانات المالية، فمفيش رقم راتب ولا تليفون.
 */
export const attendanceStatementEmployeeOptions = responseObject({
  employees: z.array(
    z.strictObject({
      employee_id: id,
      name_ar: z.string().nullable(),
      name_en: z.string(),
      employee_number: z.number().int().min(1).max(999999),
    }),
  ),
}).meta({ id: 'AttendanceStatementEmployeeOptions' });

export type AttendanceStatementEmployeesQuery = z.infer<typeof attendanceStatementEmployeesQuery>;
export type AttendanceStatementEmployeeOptions = z.infer<typeof attendanceStatementEmployeeOptions>;
