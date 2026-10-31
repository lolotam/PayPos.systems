import { appendOutboxEvent } from '@pospay/db';
import type { RatingOutboxPort } from '../ports/rating-outbox.port.ts';

export const ratingOutbox: RatingOutboxPort = {
  append: (tx, id, event) =>
    appendOutboxEvent(tx, id, {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.payload,
    }),
};
