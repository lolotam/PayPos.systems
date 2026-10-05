import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Clock } from './ports/clock.port.ts';
import { companyCreatedConsumer } from './events/handlers/on-company-created.handler.ts';
import { createDocumentTypeSeeds } from './persistence/drizzle-document-type-seeds.ts';
import { SeedDocumentTypes } from './use-cases/seed-document-types/seed-document-types.ts';
import { DetectMissedOuts } from './use-cases/detect-missed-outs/detect-missed-outs.ts';
import { missedOutTransactions } from './persistence/missed-out.transactions.ts';
import { startMissedOutProcessor } from './jobs/missed-out.processor.ts';
import { startEmployeeImportProcessor } from './jobs/employee-import.processor.ts';
import { employeeImportTransactions } from './persistence/employee-import.transactions.ts';
import { CommitEmployeeImport } from './use-cases/commit-employee-import/commit-employee-import.ts';
import { RecoverEmployeeImports } from './use-cases/recover-employee-imports/recover-employee-imports.ts';
import { employeeImportRecoveryTransactions } from './persistence/employee-import-recovery.transactions.ts';
import { startEmployeeImportRecoveryProcessor } from './jobs/employee-import-recovery.processor.ts';

// أحداث الحضور التي يعرفها هذا الإصدار؛ AttendanceClockedIn وحده يسجل جدول الشركة ولا مستهلك أعمال لأي منها.
const ATTENDANCE_EVENT_TYPES = [
  'AttendanceClockedIn',
  'AttendanceClockedOut',
  'AttendanceMissedOut',
] as const;

export function createStaffDocumentDefaults(ids: IdGenerator) {
  return companyCreatedConsumer((tx) => new SeedDocumentTypes(createDocumentTypeSeeds(tx), ids));
}

export function startStaffWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  redisUrl: string,
  clock: Clock,
  prefix?: string,
) {
  const detect = new DetectMissedOuts(missedOutTransactions(database, ids), clock);
  const processor = startMissedOutProcessor(detect, redisUrl, prefix);
  const imports = startEmployeeImportProcessor(
    new CommitEmployeeImport(employeeImportTransactions(database, ids), ids, clock),
    redisUrl,
    prefix,
  );
  const recovery = startEmployeeImportRecoveryProcessor(
    new RecoverEmployeeImports(employeeImportRecoveryTransactions(database), clock),
    redisUrl,
    prefix,
  );
  return {
    eventTypes: [...ATTENDANCE_EVENT_TYPES, 'EmployeeImportCommitRequested'],
    deliver: (
      event: Parameters<typeof processor.deliver>[0],
      next: Parameters<typeof processor.deliver>[1],
    ) =>
      event.eventType === 'EmployeeImportCommitRequested'
        ? recovery.deliver(event, () => imports.deliver(event))
        : processor.deliver(event, next),
    ready: async () => {
      await processor.ready();
      await imports.ready();
      await recovery.ready();
    },
    close: async () => {
      await imports.close();
      await recovery.close();
      await processor.close();
    },
  };
}
