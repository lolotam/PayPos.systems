import { z } from 'zod';
import { page, pageQuery } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionMoney } from './service-session.js';

export const ownWorkMonth = z.string().regex(/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/);
export const ownServiceLinesQuery = z.strictObject({
  ...pageQuery.shape,
  month: ownWorkMonth.optional(),
  cursor: id.optional(),
});

export const ownServiceLine = z.strictObject({
  line_id: id,
  branch_name_ar: z.string().nullable(),
  branch_name_en: z.string(),
  cancelled: z.boolean(),
  cancelled_at: timestamp.optional(),
  date: z.iso.date().optional(),
  late: z.boolean().optional(),
  time: timestamp.optional(),
  service_name_ar: z.string().nullable().optional(),
  service_name_en: z.string().optional(),
  customer_name: z.string().optional(),
  list_price: sessionMoney.optional(),
  discount: sessionMoney.optional(),
  net: sessionMoney.optional(),
  share_bps: z.number().int().min(0).max(10000).optional(),
});

export const ownServiceLines = z.strictObject({
  ...page(ownServiceLine).shape,
  month: ownWorkMonth,
});
export type OwnServiceLine = z.infer<typeof ownServiceLine>;
export type OwnServiceLines = z.infer<typeof ownServiceLines>;
