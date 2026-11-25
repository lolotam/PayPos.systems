import type { ServiceCategoryClosingRequested, ServiceImportCommitRequested } from '@pospay/contracts';

export type { ServiceCategoryClosingRequested, ServiceImportCommitRequested };

/** بيتطلق في معاملة القبول لما طلب قفل أو فتح تصنيف كبير يتقبل في الخلفية. */
export const SERVICE_CATEGORY_CLOSING_REQUESTED = 'ServiceCategoryClosingRequested';

/** بيتطلق في معاملة قبول طلب تثبيت الخدمات، وحمولته معرّف المعاينة وحده (D-5). */
export const SERVICE_IMPORT_COMMIT_REQUESTED = 'ServiceImportCommitRequested';
