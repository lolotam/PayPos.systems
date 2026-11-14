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
  createDiscountSelfApprovalNoticeConsumer,
} from './orders.module.ts';

export const daySessionsReader = {
  activeLines: listActiveLinesOfCustomer,
  sessionsSince: listSessionsSince,
  countSince: countSessionsSince,
  watermark: latestSessionWatermark,
};

export { startPackagePreviewWorker } from './orders.module.ts';
export { startPackageSaleWorker } from './orders.module.ts';
export { readCurrentSessionTips } from './queries/current-session-tips.reader.ts';
export {
  readServiceLineCoveragePage,
  serviceLineCoverageStatement,
} from './queries/service-line-coverage.reader.ts';
