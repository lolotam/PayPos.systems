import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const id = sharedId.toLowerCase();
export const recordingContextQuery = z.strictObject({ recorder_membership_id: id.optional() })
  .meta({ id: 'RecordingContextQuery' });
const bps = z.number().int().min(0).max(10000);
export const recordingDiscountLimit = z.union([
  responseObject({ source: z.literal('OWNER'), bps: z.null() }),
  responseObject({ source: z.enum(['PERSON', 'BUSINESS']), bps }),
  responseObject({ source: z.literal('NOT_CONFIGURED'), bps: z.literal(0) }),
]).meta({ id: 'RecordingDiscountLimit' });
const context = responseObject({ generated_at: timestamp, business_timezone: z.string().min(1),
  recorder_membership_ids: z.array(id).min(1) });
export const recordingContext = z.union([
  context.extend({ recorder_membership_id: id, discount_limit: recordingDiscountLimit }),
  context.extend({ recorder_membership_ids: z.array(id).min(2), recorder_membership_id: z.null(), discount_limit: z.null() }),
]).meta({ id: 'RecordingContext' });
export type RecordingContextQuery = z.infer<typeof recordingContextQuery>;
export type RecordingContext = z.infer<typeof recordingContext>;
export type RecordingDiscountLimit = z.infer<typeof recordingDiscountLimit>;
export const recordingContextSchemas = [recordingContextQuery, recordingDiscountLimit, recordingContext];
