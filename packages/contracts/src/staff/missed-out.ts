import { z } from 'zod';
import { id } from '../scalars/id.js';

// بيانات مهمة الخروج المفقود في Redis هوية الشركة وحدها؛ كل حقيقة أخرى تُقرأ داخل withTenant.
export const attendanceMissedOutJob = z.strictObject({ companyId: id });
export type AttendanceMissedOutJob = z.infer<typeof attendanceMissedOutJob>;
