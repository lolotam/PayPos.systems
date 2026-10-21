import { z } from 'zod';
import { responseObject } from '../response-object.js';

export const serviceSessionCapabilities = responseObject({
  can_cancel_lines: z.boolean(),
  // زرار «تغيير المنفّذين» بيختفي عند اللي معندوش الصلاحية (PP-19.2).
  can_change_performers: z.boolean(),
}).meta({ id: 'ServiceSessionCapabilities' });
export const serviceSessionCapabilitiesSchemas = [serviceSessionCapabilities];
export type ServiceSessionCapabilities = z.infer<typeof serviceSessionCapabilities>;
