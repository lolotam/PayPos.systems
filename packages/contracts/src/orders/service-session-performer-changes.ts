import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const id = sharedId.toLowerCase();
// سقف الصفحة هنا 200 لأن سجل تغيير المنفّذين أطول من pageQuery الذي يتوقف عند 100.
export const serviceLinePerformerChangesQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).meta({ id: 'ServiceLinePerformerChangesQuery' });
export const serviceLinePerformerChangesCursor = z.strictObject({
  v: z.literal(1), company: id, business: id, branch: id, session: id, line: id,
  // عمود revision من نوع integer؛ قيمة أكبر منه كانت ستفشل في القاعدة بدل رفضها بـ 400 عند قراءة المؤشر.
  revision: z.number().int().positive().max(2147483647),
});
// الاسم والنسبة لقطة وقت التغيير (FR-016): لا معرّف موظف ولا رابط مستخدم ولا تحذير في الرد.
export const serviceLinePerformerChangePerformer = responseObject({
  name_ar: z.string().nullable(), name_en: z.string(), share_bps: z.number().int().min(1).max(10000),
}).meta({ id: 'ServiceLinePerformerChangePerformer' });
export const serviceLinePerformerChangeItem = responseObject({
  revision: z.number().int().positive(), changed_at: timestamp,
  changer_label_ar: z.string().min(1), changer_label_en: z.string().min(1),
  // بلا max: Zod يعد وحدات UTF-16، بينما CHECK القاعدة يعد 500 حرفًا فيقبل 500 رمزًا رباعي البايت.
  reason: z.string().min(1),
  before: z.array(serviceLinePerformerChangePerformer).min(1).max(4),
  after: z.array(serviceLinePerformerChangePerformer).min(1).max(4),
}).meta({ id: 'ServiceLinePerformerChangeItem' });
export const serviceLinePerformerChangesPage = responseObject({
  items: z.array(serviceLinePerformerChangeItem).max(200), next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'ServiceLinePerformerChangesPage' });
export const serviceLinePerformerChangesSchemas = [serviceLinePerformerChangesQuery, serviceLinePerformerChangePerformer,
  serviceLinePerformerChangeItem, serviceLinePerformerChangesPage];
export type ServiceLinePerformerChangesQuery = z.infer<typeof serviceLinePerformerChangesQuery>;
export type ServiceLinePerformerChangesCursor = z.infer<typeof serviceLinePerformerChangesCursor>;
export type ServiceLinePerformerChangesPage = z.infer<typeof serviceLinePerformerChangesPage>;
