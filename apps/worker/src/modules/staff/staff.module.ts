import { editorLabel, safeDisplayName, t } from '@pospay/i18n';
import { LEAVE_HISTORY_REPORT_ROW_CAP } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { notClockedInDiagnostics } from './persistence/not-clocked-in-diagnostics.ts';
import { branchPlaceAdapter } from './persistence/branch-place.adapter.ts';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { Clock } from './ports/clock.port.ts';
import { companyCreatedConsumer } from './events/handlers/on-company-created.handler.ts';
import { onStaffAccessNotice } from './events/handlers/on-staff-access-notice.handler.ts';
import { staffAccessNoticeRecipients } from './persistence/staff-access-notice-recipients.adapter.ts';
import {
  appendStaffAccessNotice,
  claimStaffAccessNotice,
  readStaffAccessActorProfile,
  readStaffAccessActorRecord,
  readStaffAccessEmployee,
} from './persistence/staff-access-notice.repository.ts';
import type { StaffAccessNoticeFallback } from './domain/staff-access-notice.ts';
import { RequestStaffAccessNotice } from './use-cases/request-staff-access-notice/request-staff-access-notice.ts';
import type { OutboxConsumer } from '../../outbox/consumer.ts';
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
import { DetectShiftEndingSoon } from './use-cases/detect-shift-ending-soon/detect-shift-ending-soon.ts';
import { shiftEndingSoonTransactions } from './persistence/shift-ending-soon.transactions.ts';
import { attendanceStatementTransactions } from './persistence/attendance-statement.transactions.ts';
import { statementIdentityReader } from './persistence/attendance-statement-identity.ts';
import { attendanceStatementOpenSessions } from './queries/attendance-statement-open-sessions.query.ts';
import { ReadAttendanceStatement } from './use-cases/read-attendance-statement/read-attendance-statement.ts';
import type { AttendanceStatementRead } from './domain/attendance-statement-data.ts';
import { leaveHistoryReportTransactions } from './persistence/leave-history-report.transactions.ts';
import { leaveHistoryReportCleanupTransactions } from './persistence/leave-history-report-cleanup.transactions.ts';
import { startLeaveHistoryReportProcessor } from './jobs/leave-history-report.processor.ts';
import { startLeaveHistoryReportCleanupProcessor } from './jobs/leave-history-report-cleanup.processor.ts';
import { BuildLeaveHistoryReport } from './use-cases/build-leave-history-report/build-leave-history-report.ts';
import { CleanLeaveHistoryReports } from './use-cases/clean-leave-history-reports/clean-leave-history-reports.ts';

// أحداث الحضور التي يعرفها هذا الإصدار؛ AttendanceClockedIn وحده يسجل جدول الشركة ولا مستهلك أعمال لأي منها.
const ATTENDANCE_EVENT_TYPES = [
  'AttendanceClockedIn',
  'AttendanceClockedOut',
  'AttendanceMissedOut',
] as const;
const STAFF_EVENT_TYPES = [
  ...ATTENDANCE_EVENT_TYPES,
  'EmployeeImportCommitRequested',
  'EmployeeDocumentRecorded',
  'LeaveHistoryReportRequested',
] as const;

const NOT_CLOCKED_IN_NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

// أسماء أجراس الحضور والمستندات: نفس الأسماء العامة مع نوع المستند، والكتالوج هو المصدر (CLAUDE.md §7).
const STAFF_ALERT_NAME_FALLBACK = {
  ...NOT_CLOCKED_IN_NAME_FALLBACK,
  documentAr: t('ar', 'inApp.generic_document'),
  documentEn: t('en', 'inApp.generic_document'),
};

export function createStaffDocumentDefaults(ids: IdGenerator) {
  return companyCreatedConsumer((tx) => new SeedDocumentTypes(createDocumentTypeSeeds(tx), ids));
}

/** تسميات جرس وصول الدخول: الموظفة والفرع والفاعل، من كتالوج اللغتين (CLAUDE.md §7). */
function staffAccessNoticeFallback(): StaffAccessNoticeFallback {
  return {
    employee: { ar: t('ar', 'inApp.generic_employee'), en: t('en', 'inApp.generic_employee') },
    branch: { ar: t('ar', 'inApp.generic_branch'), en: t('en', 'inApp.generic_branch') },
    actor: { ar: t('ar', 'inApp.editor_generic'), en: t('en', 'inApp.editor_generic') },
    safeName: safeDisplayName,
    actorText: editorLabel,
  };
}

/**
 * مستهلك جرس وصول الدخول: يحوّل حدث منح الدخول وإعادة ضبط الرقم السري لجرس للمالكين النشطين.
 * التسمية والاسم الآمن من الكتالوج، والجرس ما فيهوش رقم سري ولا هاتف.
 *
 * @param ids مولّد المعرّفات لصف الدفتر وأحداث المجموعات
 * @param clock الساعة التي تحدد لحظة نافذة العضوية
 * @returns مستهلك الأوتبوكس لحدثي `StaffAccessGranted` و`StaffPinSetByOther`
 */
export function createStaffAccessNoticeConsumer(ids: IdGenerator, clock: Clock): OutboxConsumer {
  const bind = (tx: Tx) =>
    new RequestStaffAccessNotice(
      {
        ...staffAccessNoticeRecipients(tx),
        place: async (companyId, businessId, branchId) => {
          const place = await branchPlaceAdapter.forBranch(tx, companyId, businessId, branchId);
          if (place === null) return null;
          return { nameAr: place.nameAr, nameEn: place.nameEn, timeZone: place.timeZone };
        },
        readEmployee: (companyId, employeeId) =>
          readStaffAccessEmployee(tx, companyId, employeeId),
        readActorRecord: (event) => readStaffAccessActorRecord(tx, event),
        readActorProfile: (companyId, businessId, actorUserId, at) =>
          readStaffAccessActorProfile(tx, companyId, businessId, actorUserId, at),
        claim: (sourceEventId) => claimStaffAccessNotice(tx, sourceEventId),
        outbox: {
          append: (eventId, employeeId, kind, payload) =>
            appendStaffAccessNotice(tx, eventId, employeeId, kind, payload),
        },
      },
      ids,
      clock,
      staffAccessNoticeFallback(),
    );
  return {
    id: 'staff.staff-access-notice-v1',
    eventTypes: ['StaffAccessGranted', 'StaffPinSetByOther'],
    handle: (tx, event) => onStaffAccessNotice(bind(tx), event),
  };
}

/**
 * قارئ كشف الحضور الرسمي في الـ worker: معاملة قراءة واحدة للطلب وللمدخلات، وبعدها الحساب.
 * المصنع لوحده عشان مصدر الـ documents ياخد القارئ من غير ما يبني طوابير الوظائف (FR-010).
 */
export function createAttendanceStatementReader(database: Pick<TenantWrappers, 'withTenant'>) {
  const useCase = new ReadAttendanceStatement(
    attendanceStatementTransactions(
      database,
      statementIdentityReader,
      branchPlaceAdapter,
      attendanceStatementOpenSessions,
    ),
  );
  return (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<AttendanceStatementRead> => useCase.execute(companyId, renderId, signal);
}

// مهلة البناء تحد كلفة الاستعلام الثقيل وتترك للتقرير نتيجة فشل قابلة للقراءة بدل تعليقه.
const LEAVE_HISTORY_REPORT_BUILD_TIMEOUT_MS = 60_000;
// كتابة حالة الفشل تجري بعد انتهاء مهلة البناء، فمهلتها قصيرة حتى لا تضاعف زمن الإمساك بالاتصال.
const LEAVE_HISTORY_REPORT_FAILURE_TIMEOUT_MS = 5_000;
// كل دفعة تنظيف قصيرة حتى لا يحمل حذف الصفوف الكثيرة اتصال العامل.
const LEAVE_HISTORY_REPORT_CLEANUP_TIMEOUT_MS = 30_000;

function startLeaveHistoryReportWorkers(
  database: Pick<TenantWrappers, 'withTenant'>,
  redisUrl: string,
  prefix?: string,
) {
  const logger = createLogger('error');
  const reports = startLeaveHistoryReportProcessor(
    new BuildLeaveHistoryReport(
      leaveHistoryReportTransactions(
        database,
        LEAVE_HISTORY_REPORT_BUILD_TIMEOUT_MS,
        LEAVE_HISTORY_REPORT_ROW_CAP,
        LEAVE_HISTORY_REPORT_FAILURE_TIMEOUT_MS,
      ),
      {
        failed: ({ companyId, reportId, createdBy, code }) =>
          logger.error(
            { company_id: companyId, report_id: reportId, user_id: createdBy, code },
            'leave history report failed',
          ),
      },
    ),
    redisUrl,
    prefix,
  );
  const cleanup = startLeaveHistoryReportCleanupProcessor(
    new CleanLeaveHistoryReports(
      leaveHistoryReportCleanupTransactions(database, LEAVE_HISTORY_REPORT_CLEANUP_TIMEOUT_MS),
    ),
    redisUrl,
    prefix,
  );
  return {
    reports,
    cleanup,
    ready: async () => {
      await Promise.all([reports.ready(), cleanup.ready()]);
    },
    close: async () => {
      await reports.close();
      await cleanup.close();
    },
  };
}

export function startStaffWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  redisUrl: string,
  clock: Clock,
  prefix?: string,
  retryDelayMs?: (attempt: number) => number | null,
) {
  const { processor, expiry } = createAttendanceJobs(database, ids, redisUrl, clock, prefix);
  const notClockedIn = startNotClockedInProcessor(
    createNotClockedInDetectors(database, ids, clock),
    redisUrl,
    prefix,
  );
  const imports = startEmployeeImportProcessor(
    new CommitEmployeeImport(employeeImportTransactions(database, ids), ids, clock),
    redisUrl,
    prefix,
    retryDelayMs,
  );
  const recovery = startEmployeeImportRecoveryProcessor(
    new RecoverEmployeeImports(employeeImportRecoveryTransactions(database), clock),
    redisUrl,
    prefix,
    retryDelayMs,
  );
  const reportWorkers = startLeaveHistoryReportWorkers(database, redisUrl, prefix);
  return {
    eventTypes: [...STAFF_EVENT_TYPES],
    deliver: (
      event: Parameters<typeof processor.deliver>[0],
      next: Parameters<typeof processor.deliver>[1],
    ) =>
      event.eventType === 'LeaveHistoryReportRequested'
        ? reportWorkers.cleanup.deliver(event, () => reportWorkers.reports.deliver(event))
        : event.eventType === 'EmployeeImportCommitRequested'
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
    reportsReady: reportWorkers.ready,
    close: async () => {
      await expiry.close();
      await notClockedIn.close();
      await imports.close();
      await recovery.close();
      await processor.close();
      await reportWorkers.close();
    },
  };
}

/** وظيفتا الحضور اللي بتوصل بجرس: الخروج المفقود وانتهاء المستندات، بأسماء الأجراس من الكتالوج. */
function createAttendanceJobs(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  redisUrl: string,
  clock: Clock,
  prefix?: string,
) {
  const processor = startMissedOutProcessor(
    new DetectMissedOuts(missedOutTransactions(database, ids, STAFF_ALERT_NAME_FALLBACK), clock),
    redisUrl,
    prefix,
  );
  const expiry = startDocumentExpiryProcessor(
    new DetectDocumentExpiries(
      documentExpiryTransactions(database, ids, STAFF_ALERT_NAME_FALLBACK),
      clock,
    ),
    redisUrl,
    prefix,
  );
  return { processor, expiry };
}

// تنبيه عدم الرجوع من البريك وتذكير «دوامك قرب يخلص» يركبوا نفس جدولة الشركة (BW-Q5، ADR-0053)، فلا طابور ولا تسجيل جديد.
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
    new DetectShiftEndingSoon(
      shiftEndingSoonTransactions(database, ids, branchPlaceAdapter),
      clock,
      NOT_CLOCKED_IN_NAME_FALLBACK,
      notClockedInDiagnostics(logger, 'ATTENDANCE_SHIFT_ENDING_SOON_RETRY'),
    ),
  ];
}
