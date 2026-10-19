import { z } from 'zod';
import { responseObject } from '../response-object.js';

export const serviceSessionCapabilities = responseObject({
  can_cancel_lines: z.boolean(),
}).meta({ id: 'ServiceSessionCapabilities' });
export const serviceSessionCapabilitiesSchemas = [serviceSessionCapabilities];
export type ServiceSessionCapabilities = z.infer<typeof serviceSessionCapabilities>;
