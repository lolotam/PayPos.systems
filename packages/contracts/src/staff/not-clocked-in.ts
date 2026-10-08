import { z } from 'zod';
import { id } from '../scalars/id.js';

// بيانات مهمة عدم الحضور في Redis هوية الشركة وحدها؛ كل حقيقة أخرى تُقرأ داخل withTenant.
export const attendanceNotClockedInJob = z.strictObject({ companyId: id });
export type AttendanceNotClockedInJob = z.infer<typeof attendanceNotClockedInJob>;
