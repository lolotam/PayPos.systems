import { z } from 'zod';
import { employeeCardCode } from './employee-cards.js';

// مدخل مسار الكارت: الكود فقط؛ الفرع والجهاز والعامل كلها من الجلسة لا من الجسم.
export const clockByCardInput = z
  .strictObject({ card_code: employeeCardCode })
  .meta({ id: 'ClockByCardInput' });
export const clockByCardSchemas = [clockByCardInput];
export type ClockByCardInput = z.infer<typeof clockByCardInput>;
