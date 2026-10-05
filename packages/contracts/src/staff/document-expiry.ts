import { z } from 'zod';

import { id } from '../scalars/id.js';

// بيانات مهمة انتهاء الوثائق في Redis: هوية الشركة وحدها؛ كل حقيقة أخرى تُقرأ داخل withTenant.
export const documentExpiryJob = z.strictObject({ companyId: id });
export type DocumentExpiryJob = z.infer<typeof documentExpiryJob>;
