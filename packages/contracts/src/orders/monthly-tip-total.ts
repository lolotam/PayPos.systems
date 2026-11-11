import { z } from 'zod';

// إجمالي رد الشهر فقط؛ حدود مبالغ الزيارات لا تتغير.
export const monthlyTipTotal = z.string().regex(/^(0|[1-9]\d*)\.\d{3}$/);
