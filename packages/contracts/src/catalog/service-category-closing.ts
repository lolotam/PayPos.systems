import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

import { closeServiceCategoryResult, reopenServiceCategoryResult } from './service-category.js';

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

/** فعل الطلب: قفل التصنيف أم فتحه. */
export const serviceCategoryClosingAction = z
  .enum(['close', 'reopen'])
  .meta({ id: 'ServiceCategoryClosingAction' });

/** حالة الطلب: معلّق في الخلفية، أو اكتمل، أو فشل. */
export const serviceCategoryClosingState = z
  .enum(['pending', 'completed', 'failed'])
  .meta({ id: 'ServiceCategoryClosingState' });

/** رد القبول ٢٠٢: الطلب اتقبل وشغّال في الخلفية، والتصنيف لسه ما اتغيّرش. */
export const serviceCategoryClosingPending = z
  .strictObject({
    closing_id: id,
    status: z.literal('pending'),
  })
  .meta({ id: 'ServiceCategoryClosingPending' });

/** حالة الطلب كما تقراها شاشة المتابعة: النتيجة ورمز الفشل ووقتا الطلب والانتهاء. */
export const serviceCategoryClosingStatus = z
  .strictObject({
    closing_id: id,
    category_id: id,
    action: serviceCategoryClosingAction,
    status: serviceCategoryClosingState,
    services_changed: z.number().int().min(0).nullable(),
    error_code: z.enum(SERVICE_CATEGORY_CLOSING_FAILURE_CODES).nullable(),
    requested_at: timestamp,
    finished_at: timestamp.nullable(),
  })
  .meta({ id: 'ServiceCategoryClosingStatus' });

/** نتيجة القفل: اتقفل متزامناً (٢٠٠)، أو اتقبل في الخلفية (٢٠٢). */
export const serviceCategoryCloseOutcome = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('done'), result: closeServiceCategoryResult }),
    z.strictObject({ kind: z.literal('pending'), result: serviceCategoryClosingPending }),
  ])
  .meta({ id: 'ServiceCategoryCloseOutcome' });

/** نتيجة الفتح: اتفتح متزامناً (٢٠٠)، أو اتقبل في الخلفية (٢٠٢). */
export const serviceCategoryReopenOutcome = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('done'), result: reopenServiceCategoryResult }),
    z.strictObject({ kind: z.literal('pending'), result: serviceCategoryClosingPending }),
  ])
  .meta({ id: 'ServiceCategoryReopenOutcome' });

export const serviceCategoryClosingSchemas = [
  serviceCategoryClosingAction,
  serviceCategoryClosingState,
  serviceCategoryClosingPending,
  serviceCategoryClosingStatus,
];

export type ServiceCategoryClosingAction = z.infer<typeof serviceCategoryClosingAction>;
export type ServiceCategoryClosingState = z.infer<typeof serviceCategoryClosingState>;
export type ServiceCategoryClosingPending = z.infer<typeof serviceCategoryClosingPending>;
export type ServiceCategoryClosingStatus = z.infer<typeof serviceCategoryClosingStatus>;
export type ServiceCategoryCloseOutcome = z.infer<typeof serviceCategoryCloseOutcome>;
export type ServiceCategoryReopenOutcome = z.infer<typeof serviceCategoryReopenOutcome>;
