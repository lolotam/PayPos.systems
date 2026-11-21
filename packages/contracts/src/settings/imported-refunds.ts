import { z } from 'zod';

import { responseObject } from '../response-object.js';

/**
 * جسم الكتابة: القيمة المطلوبة للمفتاح. الكائن صارم — حقل ناقص أو زائد أو غير منطقي يرفض 400.
 */
export const setImportedRefundsInput = z
  .strictObject({ imported_refunds_enabled: z.boolean() })
  .meta({ id: 'SetImportedRefundsInput' });
export type SetImportedRefundsInput = z.infer<typeof setImportedRefundsInput>;

/**
 * قراية ورد الكتابة: القيمة الفعلية للمفتاح — صف غايب أو NULL أو false كلهم معناهم off.
 */
export const importedRefundsResponse = responseObject({
  imported_refunds_enabled: z.boolean(),
}).meta({ id: 'ImportedRefundsResponse' });
export type ImportedRefundsResponse = z.infer<typeof importedRefundsResponse>;
