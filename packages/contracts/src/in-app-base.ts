import { z } from 'zod';

import { id } from './scalars/id.js';

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
