import type { Tx } from '@pospay/db';
import { branchManagerRecipients, ratingCommentReaders } from '../../identity/index.ts';
import type { LowRatingRecipients } from '../ports/low-rating-notice.ports.ts';

export function lowRatingRecipients(tx: Tx): LowRatingRecipients {
  return {
    managers: (event, at, roles) =>
      branchManagerRecipients(tx, event.companyId, event.businessId, event.branchId, at, roles),
    commentReaders: (event, userIds, at) =>
      ratingCommentReaders(tx, event.companyId, event.businessId, event.branchId, userIds, at),
  };
}
