import { z } from 'zod';
import { serviceListItem } from '../catalog/service.js';
import { id } from '../scalars/id.js';

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
