import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import type { Clock } from '../../shared/ports/clock.port.ts';
import { CustomersController } from './http/customers.controller.ts';
import { RatingOptOutController } from './http/rating-opt-out.controller.ts';
import { RatingSettingsController } from './http/rating-settings.controller.ts';
import { createCustomerTransactions } from './persistence/drizzle-customer-transactions.ts';
import { createRatingOptOutTransactions } from './persistence/drizzle-rating-opt-out-transactions.ts';
import { createRatingSettingsTransactions } from './persistence/drizzle-rating-settings-transactions.ts';
import { ratingTokenHash } from './persistence/rating-token-hash.adapter.ts';
import { FindOrCreateCustomerUseCase } from './use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';
import { OptOutOfRatingsUseCase } from './use-cases/opt-out-of-ratings/opt-out-of-ratings.usecase.ts';
import { SetRatingRequests } from './use-cases/set-rating-requests/set-rating-requests.usecase.ts';

export const customersControllers = [
  CustomersController,
  RatingOptOutController,
  RatingSettingsController,
];

/** أقصى عمر لمعاملة رفض التقييم؛ القفل ما يعلّقش الطلب على زائر. */
export const RATING_TRANSACTION_TIMEOUT_MS = 1_000;

export function customersProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  clock: Clock = systemClock,
  ratingTransactionTimeoutMs: number = RATING_TRANSACTION_TIMEOUT_MS,
): Provider[] {
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
      provide: SetRatingRequests,
      useValue:
        database === undefined
          ? null
          : new SetRatingRequests(createRatingSettingsTransactions(database, ids), clock),
    },
  ];
}
