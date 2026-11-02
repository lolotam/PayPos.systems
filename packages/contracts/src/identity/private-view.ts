import { z } from 'zod';
import { responseObject } from '../response-object.js';

/** ترويسة النافذة الخاصة: المعرّف العشوائي اللي رجعه الفتح، وبيتبعت تاني مع كل طلب. */
export const PRIVATE_VIEW_WINDOW_HEADER = 'x-private-view-window-id';
/** ترويسة الوقت المتبقي على الخمول بالمللي ثانية. */
export const PRIVATE_VIEW_IDLE_REMAINING_HEADER = 'x-private-view-idle-remaining-ms';
/** ترويسة الوقت المتبقي على سقف عمر النافذة بالمللي ثانية. */
export const PRIVATE_VIEW_CAP_REMAINING_HEADER = 'x-private-view-cap-remaining-ms';

/**
 * جسم فتح النافذة: PIN الموظف نفسه وخلاص.
 * الـ strict بيرفض أي حقل تاني، فمفيش عميل يقدر يسمي موظف أو فرع أو شركة.
 */
export const privateViewOpenInput = z
  .object({
    pin: z.string().regex(/^\d{4}$/),
  })
  .strict()
  .meta({ id: 'PrivateViewOpenInput' });

/** النافذة المفتوحة: معرّفها وترتيبها وإشارة الجلسة والمدتان المتبقيان. */
export const privateViewWindow = responseObject({
  window_id: z.string().min(1).max(64),
  window_seq: z.string().min(1),
  session_ref: z.string().min(1),
  idle_remaining_ms: z.number().int().nonnegative(),
  cap_remaining_ms: z.number().int().nonnegative(),
}).meta({ id: 'PrivateViewWindow' });

/** رد اللمس: الوقتان المتبقيان على الخمول والسقف، ولا حاجة غيرهم. */
export const privateViewTouch = responseObject({
  idle_remaining_ms: z.number().int().nonnegative(),
  cap_remaining_ms: z.number().int().nonnegative(),
}).meta({ id: 'PrivateViewTouch' });

export type PrivateViewOpenInput = z.infer<typeof privateViewOpenInput>;
export type PrivateViewWindow = z.infer<typeof privateViewWindow>;
export type PrivateViewTouch = z.infer<typeof privateViewTouch>;
