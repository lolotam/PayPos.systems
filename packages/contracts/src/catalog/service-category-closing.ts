import { z } from 'zod';
import { id } from '../scalars/id.js';

export const SERVICE_CATEGORY_CLOSING_FAILURE_CODES = [
  'SERVICE_CATEGORY_REVISION_CONFLICT',
  'SERVICE_CATEGORY_ALREADY_CLOSED',
  'SERVICE_CATEGORY_NOT_CLOSED',
  'SERVICE_CATEGORY_COUNT_CHANGED',
  'SERVICE_CATEGORY_CLOSING_EXPIRED',
  'SERVICE_CATEGORY_CLOSING_FAILED',
] as const;
export type ServiceCategoryClosingFailureCode =
  (typeof SERVICE_CATEGORY_CLOSING_FAILURE_CODES)[number];

export const serviceCategoryClosingRequested = z.strictObject({ closing_id: id });
export type ServiceCategoryClosingRequested = z.infer<typeof serviceCategoryClosingRequested>;

export const serviceCategoryClosingJob = z.strictObject({ companyId: id, closingId: id });
export type ServiceCategoryClosingJob = z.infer<typeof serviceCategoryClosingJob>;

// خمس عشرة دقيقة تكفي العملية الخلفية، ولا تترك وظيفة مفقودة تمنع التصنيف من محاولة جديدة للأبد.
export const SERVICE_CATEGORY_CLOSING_DEADLINE_MS = 900_000;
