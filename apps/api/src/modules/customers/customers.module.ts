import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import { CustomersController } from './http/customers.controller.ts';
import { RatingOptOutController } from './http/rating-opt-out.controller.ts';
import { RatingSubmitController } from './http/rating-submit.controller.ts';
import { RatingViewController } from './http/rating-view.controller.ts';
import { createCustomerTransactions } from './persistence/drizzle-customer-transactions.ts';
import { createRatingOptOutTransactions } from './persistence/drizzle-rating-opt-out-transactions.ts';
import { createRatingSubmissionTransactions } from './persistence/drizzle-rating-submission-transactions.ts';
import { ratingTokenHash } from './persistence/rating-token-hash.adapter.ts';
import { FindOrCreateCustomerUseCase } from './use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';
import { OptOutOfRatingsUseCase } from './use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts';
import { SubmitRatingUseCase } from './use-cases/submit-rating/submit-rating.usecase.ts';
import { ViewRatingUseCase } from './use-cases/view-rating/view-rating.usecase.ts';

export const customersControllers = [
  CustomersController,
  RatingOptOutController,
  RatingViewController,
  RatingSubmitController,
];

/** أقصى عمر لمعاملة رابط التقييم — رفض أو إرسال؛ القفل ما يعلّقش الطلب على زائر. */
export const RATING_TRANSACTION_TIMEOUT_MS = 1_000;

export function customersProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock = systemClock,
  ratingTransactionTimeoutMs: number = RATING_TRANSACTION_TIMEOUT_MS,
): Provider[] {
  // معاملة واحدة بتخدم عرض الصفحة وإرسال التقييم؛ الاتنين على نفس الشركة المختارة من بادئة الرابط.
  const submission =
    database === undefined
      ? null
      : createRatingSubmissionTransactions(database, ids, ratingTransactionTimeoutMs);
  return [
    {
      provide: FindOrCreateCustomerUseCase,
      useValue:
        database === undefined
          ? null
          : new FindOrCreateCustomerUseCase(createCustomerTransactions(database, ids), ids, {
              now: () => new Date(),
            }),
    },
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
      provide: ViewRatingUseCase,
      useValue:
        submission === null
          ? null
          : new ViewRatingUseCase(submission, ratingTokenHash(), clock),
    },
    {
      provide: SubmitRatingUseCase,
      useValue:
        submission === null
          ? null
          : new SubmitRatingUseCase(submission, ratingTokenHash(), clock),
    },
  ];
}
