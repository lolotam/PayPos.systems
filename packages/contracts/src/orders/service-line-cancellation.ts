import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionMoney } from './service-session.js';

const previous = responseObject({
  revision: z.number().int().positive(),
  price: sessionMoney,
  discount: sessionMoney,
  net: sessionMoney,
});
export const serviceLineCancellation = responseObject({
  cancelled_at: timestamp,
  // بلا max: Zod يعد وحدات UTF-16، بينما CHECK القاعدة يعد 500 حرفًا.
  canceller_label_ar: z.string().min(1),
  canceller_label_en: z.string().min(1),
  reason: z.string().min(1),
  previous,
}).meta({ id: 'ServiceLineCancellation' });
export const serviceLineCancellationSchemas = [serviceLineCancellation];
export type ServiceLineCancellation = z.infer<typeof serviceLineCancellation>;
