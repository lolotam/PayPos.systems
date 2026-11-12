import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const calendarDate = z.iso.date();

export const extendPackageInput = z
  .strictObject({
    new_expires_on: calendarDate,
    expected_expires_on: calendarDate,
    reason: z.string(),
  })
  .meta({ id: 'ExtendPackageInput' });

export const packageExtensionResponse = responseObject({
  id,
  entitlement_id: id,
  previous_expires_on: calendarDate,
  new_expires_on: calendarDate,
  extended_at: timestamp,
}).meta({ id: 'PackageExtensionResponse' });

export type ExtendPackageInput = z.infer<typeof extendPackageInput>;
export type PackageExtensionResponse = z.infer<typeof packageExtensionResponse>;

export const packageExtensionSchemas = [extendPackageInput, packageExtensionResponse];
