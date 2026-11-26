import {
  type PrivateViewCalls,
  type PrivateViewEnv,
  defaultCalls as sharedCalls,
  defaultEnv as sharedEnv,
} from '@/private-view/env';
import { workCalls } from './my-work-calls';

export {
  CLOCK_DRIFT_MS,
  IDLE_LIMIT_MS,
  OPEN_TIMEOUT_MS,
  TICK_MS,
  TOUCH_INTERVAL_MS,
} from '@/private-view/env';
export { openWithin } from '@/private-view/env';

export type PrivateWindowEnv = PrivateViewEnv;

/** استدعاءات النافذة الخاصة في «شغلي»: فتح ولمس وإغلاق، مع قراءات الشاشة نفسها. */
export type PrivateWindowCalls = PrivateViewCalls & {
  lines: typeof workCalls.lines;
  tips: typeof workCalls.tips;
  commissionEstimate: typeof workCalls.commissionEstimate;
};

export type PrivateWindowDeps = { env: PrivateWindowEnv; calls: PrivateWindowCalls };

export const defaultEnv: PrivateWindowEnv = sharedEnv;

export const defaultCalls: PrivateWindowCalls = {
  ...sharedCalls,
  lines: (read) => workCalls.lines(read),
  tips: (read) => workCalls.tips(read),
  commissionEstimate: (read) => workCalls.commissionEstimate(read),
};
