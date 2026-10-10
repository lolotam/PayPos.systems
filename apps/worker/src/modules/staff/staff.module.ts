import { t } from '@pospay/i18n';
import { createLogger } from '@pospay/observability';
import { notClockedInDiagnostics } from './persistence/not-clocked-in-diagnostics.ts';
import { branchPlaceAdapter } from './persistence/branch-place.adapter.ts';
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
import { DetectDocumentExpiries } from './use-cases/detect-document-expiries/detect-document-expiries.ts';
import { documentExpiryTransactions } from './persistence/document-expiry.transactions.ts';
import { startDocumentExpiryProcessor } from './jobs/document-expiry.processor.ts';
import { DetectNotClockedIns } from './use-cases/detect-not-clocked-in/detect-not-clocked-in.ts';
import { notClockedInTransactions } from './persistence/not-clocked-in.transactions.ts';
import { startNotClockedInProcessor } from './jobs/not-clocked-in.processor.ts';
import { DetectBreakNotReturned } from './use-cases/detect-break-not-returned/detect-break-not-returned.ts';
import { breakNotReturnedTransactions } from './persistence/break-not-returned.transactions.ts';

// أحداث الحضور التي يعرفها هذا الإصدار؛ AttendanceClockedIn وحده يسجل جدول الشركة ولا مستهلك أعمال لأي منها.
const ATTENDANCE_EVENT_TYPES = [
  'AttendanceClockedIn',
  'AttendanceClockedOut',
  'AttendanceMissedOut',
] as const;

const NOT_CLOCKED_IN_NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

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
  const expiry = startDocumentExpiryProcessor(
    new DetectDocumentExpiries(documentExpiryTransactions(database, ids), clock),
    redisUrl,
    prefix,
  );
  const notClockedIn = startNotClockedInProcessor(
    createNotClockedInDetectors(database, ids, clock),
    redisUrl,
    prefix,
  );
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
    eventTypes: [
      ...ATTENDANCE_EVENT_TYPES,
      'EmployeeImportCommitRequested',
      'EmployeeDocumentRecorded',
    ],
    deliver: (
      event: Parameters<typeof processor.deliver>[0],
      next: Parameters<typeof processor.deliver>[1],
    ) =>
      event.eventType === 'EmployeeImportCommitRequested'
        ? recovery.deliver(event, () => imports.deliver(event))
        : expiry.deliver(event, () =>
            notClockedIn.deliver(event, () => processor.deliver(event, next)),
          ),
    ready: async () => {
      await processor.ready();
      await imports.ready();
      await recovery.ready();
      await expiry.ready();
      await notClockedIn.ready();
    },
    close: async () => {
      await expiry.close();
      await notClockedIn.close();
      await imports.close();
      await recovery.close();
      await processor.close();
    },
  };
}

// تنبيه عدم الرجوع من البريك يركب نفس جدولة الشركة (BW-Q5)، فلا طابور ولا تسجيل جديد.
function createNotClockedInDetectors(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  clock: Clock,
) {
  const logger = createLogger('error');
  return [
    new DetectNotClockedIns(
      notClockedInTransactions(database, ids, branchPlaceAdapter),
      clock,
      NOT_CLOCKED_IN_NAME_FALLBACK,
      notClockedInDiagnostics(logger),
    ),
    new DetectBreakNotReturned(
      breakNotReturnedTransactions(database, ids, branchPlaceAdapter),
      clock,
      NOT_CLOCKED_IN_NAME_FALLBACK,
      notClockedInDiagnostics(logger, 'ATTENDANCE_BREAK_NOT_RETURNED_RETRY'),
    ),
  ];
}
