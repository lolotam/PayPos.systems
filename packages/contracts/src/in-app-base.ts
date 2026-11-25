import { z } from 'zod';

import { id } from './scalars/id.js';
import { timestamp } from './scalars/timestamp.js';

/**
 * قاعدة صف الجرس داخل التطبيق: القناة والمستخدم واللغة ومراجعة القالب. كل قالب جرس بياخد
 * الحقول دي، فبتفصل هنا عشان ملفات القوالب ما تكرّرش الشكل.
 */
export const inAppBase = {
  channel: z.literal('IN_APP'),
  user_id: id,
  locale: z.enum(['ar', 'en']),
  template_revision: z.literal(1),
};

/**
 * قاعدة صف الإشعار المقروء: هويته ونطاقه ومراجعته ولغته ولحظتيه. مفصولة عن `inAppBase`
 * عشان ملفَي القوالب ما يكبروش من حد الأسطر، والصف المقروء يبني نفسه منها.
 */
export const inAppNotificationBase = {
  id,
  company_id: id,
  business_id: id.nullable(),
  branch_id: id.nullable(),
  source_event_id: id,
  template_revision: z.literal(1),
  locale: z.enum(['ar', 'en']),
  created_at: timestamp,
  read_at: timestamp.nullable(),
};
