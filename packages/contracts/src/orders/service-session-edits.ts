import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();
// سقف الصفحة هنا 200 لأن سجل السطر أطول من pageQuery الذي يتوقف عند 100.
export const serviceLineEditsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).meta({ id: 'ServiceLineEditsQuery' });
export const serviceLineEditsCursor = z.strictObject({
  v: z.literal(1), company: id, business: id, branch: id, session: id, line: id,
  // عمود revision من نوع integer؛ قيمة أكبر منه كانت ستفشل في القاعدة بدل رفضها بـ 400 عند قراءة المؤشر.
  revision: z.number().int().positive().max(2147483647),
});
const amounts = responseObject({ price: sessionMoney, discount: sessionMoney, net: sessionMoney });
export const serviceLineEditItem = responseObject({
  revision: z.number().int().positive(), previous: amounts, new: amounts, changed_at: timestamp,
  // بلا max: Zod يعد وحدات UTF-16، بينما CHECK القاعدة يعد 500 حرفًا فيقبل 500 رمزًا رباعي البايت.
  editor_label_ar: z.string().min(1), editor_label_en: z.string().min(1), reason: z.string().min(1),
}).meta({ id: 'ServiceLineEditItem' });
export const serviceLineEditsPage = responseObject({
  items: z.array(serviceLineEditItem).max(200), next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'ServiceLineEditsPage' });
export const serviceLineEditsSchemas = [serviceLineEditsQuery, serviceLineEditItem, serviceLineEditsPage];
export type ServiceLineEditsQuery = z.infer<typeof serviceLineEditsQuery>;
export type ServiceLineEditsCursor = z.infer<typeof serviceLineEditsCursor>;
export type ServiceLineEditsPage = z.infer<typeof serviceLineEditsPage>;
