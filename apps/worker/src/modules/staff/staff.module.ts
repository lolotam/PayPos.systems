import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Clock } from './ports/clock.port.ts';
import { DetectMissedOuts } from './use-cases/detect-missed-outs/detect-missed-outs.ts';
import { missedOutTransactions } from './persistence/missed-out.transactions.ts';
import { startMissedOutProcessor } from './jobs/missed-out.processor.ts';

// أحداث الحضور التي يعرفها هذا الإصدار؛ AttendanceClockedIn وحده يسجل جدول الشركة ولا مستهلك أعمال لأي منها.
const ATTENDANCE_EVENT_TYPES = [
  'AttendanceClockedIn',
  'AttendanceClockedOut',
  'AttendanceMissedOut',
] as const;

export function startStaffWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  redisUrl: string,
  clock: Clock,
  prefix?: string,
) {
  const detect = new DetectMissedOuts(missedOutTransactions(database, ids), clock);
  const processor = startMissedOutProcessor(detect, redisUrl, prefix);
  return { eventTypes: ATTENDANCE_EVENT_TYPES, ...processor };
}
