import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { packagePaidMethod } from './package-sale.js';
import { sessionMoney } from './service-session.js';

// The reason is capped by the written-reason rule and the row check, not here: the contract only refuses
// a body that is not a string, so the trimmed length stays one rule instead of two.
export const refundPackageInput = z
  .strictObject({
    component_id: id.toLowerCase(),
    sessions: z.number().int().positive(),
    method: packagePaidMethod,
    reason: z.string(),
  })
  .meta({ id: 'RefundPackageInput' });

export const packageRefundResponse = responseObject({
  id,
  entitlement_id: id,
  component_id: id,
  sessions: z.number().int().positive(),
  amount: sessionMoney,
  method: packagePaidMethod,
  refunded_amount: sessionMoney,
  revision: z.number().int().positive(),
  refunded_at: timestamp,
}).meta({ id: 'PackageRefundResponse' });

export type RefundPackageInput = z.infer<typeof refundPackageInput>;
export type PackageRefundResponse = z.infer<typeof packageRefundResponse>;

export const packageRefundSchemas = [refundPackageInput, packageRefundResponse];
