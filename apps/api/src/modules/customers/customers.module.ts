import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import {
  BranchCustomerImportController,
  BusinessCustomerImportController,
} from './http/customer-import.controller.ts';
import { CustomerProfileController } from './http/customer-profile.controller.ts';
import { CustomersController } from './http/customers.controller.ts';
import { RatingOptOutController } from './http/rating-opt-out.controller.ts';
import { RatingSettingsController } from './http/rating-settings.controller.ts';
import { RatingSubmitController } from './http/rating-submit.controller.ts';
import { RatingViewController } from './http/rating-view.controller.ts';
import { businessNames } from './persistence/business-names.adapter.ts';
import { createCustomerImportTemplateBuilder } from './persistence/customer-import-template.ts';
import {
  createCustomerImportSheetReader,
  createCustomerImportTransactions,
  customerImportScopeReads,
} from './persistence/drizzle-customer-import.ts';
import { createCustomerTransactions } from './persistence/drizzle-customer-transactions.ts';
import { createRatingOptOutTransactions } from './persistence/drizzle-rating-opt-out-transactions.ts';
import { createRatingSettingsTransactions } from './persistence/drizzle-rating-settings-transactions.ts';
import {
  createRatingSubmitTransactions,
  createRatingViewTransactions,
} from './persistence/drizzle-rating-submission-transactions.ts';
import { ownRatingContext } from './persistence/own-rating-context.adapter.ts';
import { ratingsListReads } from './persistence/ratings-list-reads.adapter.ts';
import { ratingTokenHash } from './persistence/rating-token-hash.adapter.ts';
import { staffColumns } from './persistence/staff-columns.adapter.ts';
import { branchBusiness, workspaceNames } from './persistence/workspace-names.adapter.ts';
import {
  CUSTOMER_PROFILE_CONTEXT,
  type CustomerProfileContext,
} from './queries/customer-profile.query.ts';
import { OWN_RATING_READS } from './queries/own-rating-context.ts';
import { RATINGS_LIST_READS } from './queries/ratings-list-reads.ts';
import { CUSTOMER_IMPORT_SCOPE_READS } from './queries/customer-import-reads.query.ts';
import { RatingsController, RATINGS_LIST_CLOCK } from './http/ratings.controller.ts';
import {
  OwnRatingSummaryController,
  OWN_RATING_CLOCK,
} from './http/own-rating-summary.controller.ts';
import { FindOrCreateCustomerUseCase } from './use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';
import {
  CommitCustomerImportUseCase,
  GetCustomerImportTemplateUseCase,
  PreviewCustomerImportUseCase,
} from './use-cases/customer-import/customer-import.usecases.ts';
import type { CustomerImportFilesBinding } from './ports/customer-import.port.ts';
import { OptOutOfRatingsUseCase } from './use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts';
import { SetRatingRequests } from './use-cases/set-rating-requests/set-rating-requests.usecase.ts';
import { SubmitRatingUseCase } from './use-cases/submit-rating/submit-rating.usecase.ts';
import { ViewRatingUseCase } from './use-cases/view-rating/view-rating.usecase.ts';

export const customersControllers = [
  BusinessCustomerImportController,
  BranchCustomerImportController,
  CustomersController,
  CustomerProfileController,
  RatingOptOutController,
  RatingSettingsController,
  RatingViewController,
  RatingSubmitController,
  OwnRatingSummaryController,
  RatingsController,
];

/** أقصى عمر لمعاملة رابط التقييم — رفض أو إرسال؛ القفل ما يعلّقش الطلب على زائر. */
export const RATING_TRANSACTION_TIMEOUT_MS = 1_000;

// أسماء أنشطة الملاحظات: القراءة بتاخدها بنفس شكل الـ context بتاع حد القراءة.
const profileNames: CustomerProfileContext = workspaceNames.names;

/** قراءة متوسط التقييم: السلطة الحالية أولًا ثم بوابة عمود الإعداد على نفس معاملة القراءة (61-2a). */
const ownRatingProviders = (clock: Clock): Provider[] => [
  {
    provide: OWN_RATING_READS,
    useValue: { context: ownRatingContext, allowed: staffColumns.allowed },
  },
  { provide: OWN_RATING_CLOCK, useValue: clock },
];

/** قراءة قائمة التقييمات في الأدمن: الصلاحية الحالية وأسماء الفروع على معاملة القراءة نفسها (61-2b). */
const ratingsListProviders = (clock: Clock): Provider[] => [
  { provide: RATINGS_LIST_READS, useValue: ratingsListReads },
  { provide: RATINGS_LIST_CLOCK, useValue: clock },
];

/** استيراد العملاء: بلا تخزين مهيأ المعاينة وحدها معطّلة، وبلا قاعدة بيانات المسارات كلها (073 D-2). */
const customerImportProviders = (
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock,
  files: CustomerImportFilesBinding | null,
): Provider[] => {
  const importFiles: CustomerImportFilesBinding = files ?? {
    fileFacts: { facts: async () => null },
    bytes: null,
  };
  const transactions =
    database === undefined ? null : createCustomerImportTransactions(database, importFiles, ids);
  const template = createCustomerImportTemplateBuilder();
  const preview =
    transactions === null || files === null || files.bytes === null
      ? null
      : new PreviewCustomerImportUseCase(
          transactions,
          files.bytes,
          createCustomerImportSheetReader(),
          ids,
          clock,
        );
  return [
    {
      provide: GetCustomerImportTemplateUseCase,
      useValue:
        transactions === null ? null : new GetCustomerImportTemplateUseCase(transactions, template),
    },
    { provide: PreviewCustomerImportUseCase, useValue: preview },
    {
      provide: CommitCustomerImportUseCase,
      useValue: transactions === null ? null : new CommitCustomerImportUseCase(transactions, clock),
    },
    { provide: CUSTOMER_IMPORT_SCOPE_READS, useValue: customerImportScopeReads },
  ];
};

export function customersProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock = systemClock,
  ratingTransactionTimeoutMs: number = RATING_TRANSACTION_TIMEOUT_MS,
  files: CustomerImportFilesBinding | null = null,
): Provider[] {
  // معاملة واحدة لكل طلب: العرض بيقرأ بس، والإرسال بيقفل ويكتب — والاتنين على نفس الشركة المختارة من بادئة الرابط.
  const view =
    database === undefined
      ? null
      : createRatingViewTransactions(database, ratingTransactionTimeoutMs, businessNames);
  const submit =
    database === undefined
      ? null
      : createRatingSubmitTransactions(database, ids, ratingTransactionTimeoutMs);
  const findOrCreate =
    database === undefined
      ? null
      : new FindOrCreateCustomerUseCase(
          createCustomerTransactions(database, ids, branchBusiness),
          ids,
          { now: () => new Date() },
        );
  return [
    { provide: FindOrCreateCustomerUseCase, useValue: findOrCreate },
    ...customerImportProviders(database, ids, clock, files),
    { provide: CUSTOMER_PROFILE_CONTEXT, useValue: profileNames },
    {
      provide: OptOutOfRatingsUseCase,
      useValue:
        database === undefined
          ? null
          : new OptOutOfRatingsUseCase(
              createRatingOptOutTransactions(database, ids, ratingTransactionTimeoutMs),
              ratingTokenHash(),
              clock,
            ),
    },
    {
      provide: SetRatingRequests,
      useValue:
        database === undefined
          ? null
          : new SetRatingRequests(createRatingSettingsTransactions(database, ids), clock),
    },
    {
      provide: ViewRatingUseCase,
      useValue: view === null ? null : new ViewRatingUseCase(view, ratingTokenHash(), clock),
    },
    {
      provide: SubmitRatingUseCase,
      useValue: submit === null ? null : new SubmitRatingUseCase(submit, ratingTokenHash(), clock),
    },
    ...ownRatingProviders(clock),
    ...ratingsListProviders(clock),
  ];
}
