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

export const sessionPerformerOptionsQuery = sessionServiceOptionsQuery.extend({
  occurred_at: timestamp,
  q: z.string().trim().min(1).max(50).optional(),
}).meta({ id: 'SessionPerformerOptionsQuery' });
export const sessionPerformerOption = z.strictObject({
  id: id.toLowerCase(), name_ar: nameAr.nullable(), name_en: nameEn,
  not_clocked_in_warning: z.boolean(),
  approved_leave_warning: z.boolean(),
}).meta({ id: 'SessionPerformerOption' });
export const sessionPerformerOptionPage = z.strictObject({
  items: z.array(sessionPerformerOption).max(100),
  next_cursor: id.toLowerCase().nullable(),
}).meta({ id: 'SessionPerformerOptionPage' });
export type SessionPerformerOptionsQuery = z.infer<typeof sessionPerformerOptionsQuery>;
export type SessionPerformerOptionPage = z.infer<typeof sessionPerformerOptionPage>;
export const sessionPerformerOptionsSchemas = [sessionPerformerOptionsQuery, sessionPerformerOption, sessionPerformerOptionPage];
