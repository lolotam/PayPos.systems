import { z } from 'zod';
import { serviceListItem } from '../catalog/service.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { nameAr, nameEn } from '../bilingual/names.js';

export const sessionServiceOptionsQuery = z.strictObject({
  cursor: id.toLowerCase().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).meta({ id: 'SessionServiceOptionsQuery' });
export const sessionServiceOption = serviceListItem.pick({
  id: true, name_ar: true, name_en: true, price: true, revision: true,
}).strict().meta({ id: 'SessionServiceOption' });
export const sessionServiceOptionPage = z.strictObject({
  items: z.array(sessionServiceOption).max(100),
  next_cursor: id.toLowerCase().nullable(),
}).meta({ id: 'SessionServiceOptionPage' });
export type SessionServiceOptionsQuery = z.infer<typeof sessionServiceOptionsQuery>;
export type SessionServiceOptionPage = z.infer<typeof sessionServiceOptionPage>;
export const sessionServiceOptionsSchemas = [sessionServiceOptionsQuery, sessionServiceOption, sessionServiceOptionPage];

const performerCursor = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
export const sessionPerformerCursorData = z.strictObject({
  key: z.string().max(1024).refine((value) => !value.includes('\u0000')), id: id.toLowerCase(),
  lang: z.enum(['ar', 'en']), q_hash: z.string().regex(/^[a-f0-9]{64}$/),
  working_date: z.iso.date(),
});
export const sessionPerformerOptionsQuery = sessionServiceOptionsQuery.extend({
  cursor: performerCursor.optional(),
  lang: z.enum(['ar', 'en']),
  occurred_at: timestamp.describe('POST window: from the first of the previous month in business timezone through server now + 120 seconds; tolerated future values normalize to server now.'),
  q: z.string().trim().min(1).max(50).optional(),
}).meta({ id: 'SessionPerformerOptionsQuery' });
export const sessionPerformerOption = z.strictObject({
  id: id.toLowerCase(), name_ar: nameAr.nullable(), name_en: nameEn,
  not_clocked_in_warning: z.boolean(),
  approved_leave_warning: z.boolean(),
}).meta({ id: 'SessionPerformerOption' });
export const sessionPerformerOptionPage = z.strictObject({
  items: z.array(sessionPerformerOption).max(100),
  next_cursor: performerCursor.nullable(),
}).meta({ id: 'SessionPerformerOptionPage' });
export type SessionPerformerOptionsQuery = z.infer<typeof sessionPerformerOptionsQuery>;
export type SessionPerformerOptionPage = z.infer<typeof sessionPerformerOptionPage>;
export const sessionPerformerOptionsSchemas = [sessionPerformerOptionsQuery, sessionPerformerOption, sessionPerformerOptionPage];
