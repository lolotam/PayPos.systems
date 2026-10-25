import { listActiveLinesOfCustomer } from './queries/day-sessions.query.ts';
import {
  countSessionsSince,
  latestSessionWatermark,
  listSessionsSince,
} from './queries/day-sessions-since.query.ts';

export {
  createLateServiceSessionNoticeConsumer,
  createLineCancelNoticeConsumer,
  createPerformersChangeNoticeConsumer,
  createPriceEditNoticeConsumer,
  createDiscountApprovalNoticeConsumer,
} from './orders.module.ts';

export const daySessionsReader = {
  activeLines: listActiveLinesOfCustomer,
  sessionsSince: listSessionsSince,
  countSince: countSessionsSince,
  watermark: latestSessionWatermark,
};
