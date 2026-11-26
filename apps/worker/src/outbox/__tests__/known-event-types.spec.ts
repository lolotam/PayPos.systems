vi.mock('../../modules/orders/jobs/package-preview.processor.ts', () => ({
  startPackagePreviewProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
vi.mock('../../modules/orders/jobs/package-sale.processor.ts', () => ({
  startPackageSaleProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
vi.mock('../../modules/orders/jobs/package-sale-recovery.processor.ts', () => ({
  startPackageSaleRecoveryProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    register: async () => undefined,
  }),
}));
vi.mock('../../modules/orders/jobs/package-import-commit.processor.ts', () => ({
  startPackageImportCommitProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
vi.mock('../../modules/orders/jobs/package-import-recovery.processor.ts', () => ({
  startPackageImportRecoveryProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    register: async () => undefined,
  }),
}));
vi.mock('../../modules/catalog/jobs/service-category-closing.processor.ts', () => ({
  startServiceCategoryClosingProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
vi.mock('../../modules/catalog/jobs/service-import-recovery.processor.ts', () => ({
  startServiceImportRecoveryProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    register: async () => undefined,
  }),
}));
vi.mock('../../modules/customers/jobs/customer-import.processor.ts', () => ({
  startCustomerImportProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
import { startCatalogWorker } from '../../modules/catalog/index.ts';
import {
  startPackagePreviewWorker,
  startPackageSaleWorker,
  startPackageImportCommitWorker,
} from '../../modules/orders/index.ts';
import type { Database } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { expect, it, vi } from 'vitest';

import {
  createNotificationModule,
  createInAppNotificationModule,
} from '../../modules/notifications/index.ts';
import { startStaffWorker } from '../../modules/staff/index.ts';
import { startCustomersImportWorker } from '../../modules/customers/index.ts';
import type * as CustomersModule from '../../modules/customers/index.ts';
import { businessConsumers } from '../../business-consumers.ts';
import { businessPermissionHolders } from '../../modules/identity/index.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import { readEmployeeBusiness } from '../../modules/staff/index.ts';
import { businessCalendar, businessTimeZone } from '../../modules/tenancy/index.ts';
import { createDeliverer } from '../deliver.ts';
import { KNOWN_EVENT_TYPES, knownEventTypes } from '../known-event-types.ts';
import { emittedEventTypes } from './emitted-event-types.ts';
import { retryDelayMs } from '../retry-policy.ts';

// نعزل اتصالات الطوابير فقط؛ قوائم الأنواع والمستهلكون تأتي من تركيب الوحدات الحقيقي.
vi.mock('../../modules/staff/jobs/missed-out.processor.ts', () => ({
  startMissedOutProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/not-clocked-in.processor.ts', () => ({
  startNotClockedInProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/employee-import.processor.ts', () => ({
  startEmployeeImportProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/employee-import-recovery.processor.ts', () => ({
  startEmployeeImportRecoveryProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/document-expiry.processor.ts', () => ({
  startDocumentExpiryProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/leave-history-report.processor.ts', () => ({
  startLeaveHistoryReportProcessor: () => ({}),
}));
vi.mock('../../modules/staff/jobs/leave-history-report-cleanup.processor.ts', () => ({
  startLeaveHistoryReportCleanupProcessor: () => ({}),
}));

const database: Pick<Database, 'withTenant'> = { withTenant: vi.fn() };
const ids = { newId: () => '01990000-0000-7000-8000-000000000001' };
const clock = { now: () => new Date('2026-10-08T00:00:00Z') };
const options = { database, ids, clock };
const staff = startStaffWorker(database, ids, 'synthetic', clock);
const notifications = createNotificationModule({
  ...options,
  production: false,
  configuration: { mode: 'fake', hashKey: 'synthetic-test-key'.repeat(3), hashKeyId: 'test-v1' },
});
const inApp = createInAppNotificationModule(options);
const previews = startPackagePreviewWorker(database, async () => null, 'synthetic', clock);
const sales = startPackageSaleWorker(database, ids, {
  redisUrl: 'synthetic',
  clock,
  transactionTimeoutMs: 5000,
});
const imports = startPackageImportCommitWorker(database, ids, {
  redisUrl: 'synthetic',
  clock,
  transactionTimeoutMs: 5000,
});
const catalog = startCatalogWorker(database, ids, 'synthetic', clock);
const customerImports = startCustomersImportWorker(database, ids, {
  redisUrl: 'synthetic',
  clock,
});
const productionConsumers = () =>
  businessConsumers({
    files: { id: 'files.upload', eventTypes: [], handle: async () => undefined },
    notifications: notifications.consumer,
    inApp: null,
    newIds: () => ids,
    clock,
    daySessions: daySessionsReader,
    commissions: {
      businessTimeZone,
      employeeBusiness: readEmployeeBusiness,
      businessCalendar,
      permissionHolders: businessPermissionHolders,
    },
  });

it('recognizes every event emitted by API and worker, including finite template expansions', () => {
  const emitted = emittedEventTypes();
  // المستهلكون من نفس دالة التركيب اللي يسجّل بها main.ts، فنسيان تسجيل مستهلك في الإقلاع (مثل الجرس المنخفض) يفشل هنا.
  // LowRatingSubmitted له مستهلك حقيقي مسجَّل، فلا يدخل قائمة الأنواع المعروفة بلا مستهلك (plan 61 §2).
  const consumers = productionConsumers();
  expect(consumers.flatMap((consumer) => consumer.eventTypes)).toContain('LowRatingSubmitted');
  expect(KNOWN_EVENT_TYPES).not.toContain('LowRatingSubmitted');
  // جرس وصول الدخول: الحدثان لهما مستهلك حقيقي مسجَّل، فمفيش سبب معروف بلا مستهلك.
  expect(consumers.flatMap((consumer) => consumer.eventTypes)).toContain('StaffAccessGranted');
  expect(consumers.flatMap((consumer) => consumer.eventTypes)).toContain('StaffPinSetByOther');
  expect(KNOWN_EVENT_TYPES).not.toContain('StaffAccessGranted');
  // ADR-0061 §2: مستهلك علامة جدولة التذكيرات مسجَّل لـCompanyCreated في تركيب الإقلاع الحقيقي.
  expect(consumers).toContainEqual(
    expect.objectContaining({
      id: 'commissions.reminder-schedule',
      eventTypes: ['CompanyCreated'],
    }),
  );
  const supported = new Set([
    ...knownEventTypes(staff, notifications, null, previews, sales, imports, catalog, customerImports),
    ...consumers.flatMap((consumer) => consumer.eventTypes),
  ]);
  expect(catalog.eventTypes).toContain('ServiceCategoryClosingRequested');
  expect(customerImports.eventTypes).toContain('CustomerImportCommitRequested');
  expect([...emitted.keys()]).toEqual(
    expect.arrayContaining([
      'LeaveRequested',
      'LeaveCancelled',
      'LeaveApproved',
      'LeaveRejected',
      'LeaveRevoked',
      'SalaryChanged',
      'EmployeePasskeyBound',
      'DeviceRegistered',
      'DeviceRevoked',
      'NotificationDelivered',
      'NotificationFailed',
    ]),
  );
  expect([...emitted].filter(([eventType]) => !supported.has(eventType))).toEqual([]);
});

it('keeps notification transport recognition conditional on the active module', () => {
  expect(knownEventTypes(staff, null, inApp)).not.toContain('NotificationSendAuthorized');
  expect(knownEventTypes(staff, notifications, null)).toContain('NotificationSendAuthorized');
  expect(knownEventTypes(staff, null, null)).not.toContain('NotificationSendAuthorized');
});

it.each([
  'SalaryChanged',
  'SessionTipsChanged',
  'PackageSaleChanged',
  'LeaveRequested',
  'LeaveCancelled',
  'LeaveApproved',
  'LeaveRejected',
  'LeaveRevoked',
  'EmployeePasskeyBound',
  // spec 076 G1: دعوة عضو بلا مستهلك — تُقرأ من شاشة الدعوات مباشرة فتُقر بدون إعادة محاولة.
  'MemberInvited',
])('acknowledges %s without a consumer or tenant effect', async (eventType) => {
  database.withTenant = vi.fn();
  const deliver = createDeliverer(database, [], createLogger('silent'), {
    knownEventTypes: KNOWN_EVENT_TYPES,
  });
  expect(
    await deliver({
      id: ids.newId(),
      companyId: ids.newId(),
      aggregateType: 'employee',
      aggregateId: ids.newId(),
      eventType,
      payload: {},
      attempt: 1,
    }),
  ).toEqual({ delivered: true });
  expect(database.withTenant).not.toHaveBeenCalled();
});

it('retries a package preview request when its transport is absent during rolling deployment', async () => {
  database.withTenant = vi.fn();
  const deliver = createDeliverer(database, [], createLogger('silent'), {
    knownEventTypes: knownEventTypes(staff, notifications, inApp),
  });
  expect(
    await deliver({
      id: ids.newId(),
      companyId: ids.newId(),
      aggregateType: 'import_preview',
      aggregateId: ids.newId(),
      eventType: 'PackageImportPreviewRequested',
      payload: { preview_id: ids.newId() },
      attempt: 1,
    }),
  ).toEqual({ delivered: false, error: 'TypeError', retryInMs: retryDelayMs(1) });
  expect(database.withTenant).not.toHaveBeenCalled();
});

it('contributes LeaveHistoryReportRequested from the staff module', () => {
  expect(knownEventTypes(staff)).toContain('LeaveHistoryReportRequested');
});

it('recognizes the package import commit transport before its producer exists', () => {
  expect(imports.eventTypes).toEqual(['PackageImportCommitRequested']);
  expect(knownEventTypes(staff, notifications, null, previews, sales, imports, catalog, customerImports)).toContain(
    'PackageImportCommitRequested',
  );
});

type Registered = {
  consumers: { id: string; eventTypes: readonly string[] }[];
  known: readonly string[];
};
const registered: Registered[] = [];

function mockStartupDataAndAuth(): void {
  vi.doMock('@pospay/db', () => ({
    createDatabase: () => ({ close: async () => undefined, ping: async () => undefined, withTenant: vi.fn() }),
    createOutboxDispatcherDatabase: () => ({
      close: async () => undefined,
      ping: async () => undefined,
      commissionParkedEventPage: async () => [],
    }),
    createPlatformWhatsappDatabase: () => ({
      close: async () => undefined,
      ping: async () => undefined,
    }),
  }));
  vi.doMock('@pospay/auth', () => ({
    createStaffOtpExecution: () => ({ readiness: vi.fn(), close: vi.fn() }),
    createStaffOtpMaintenance: () => ({ readiness: vi.fn(), stop: vi.fn(), close: vi.fn() }),
    readStaffOtpConfiguration: () => ({ state: 'DISABLED', fingerprint: 'synthetic-worker' }),
  }));
  vi.doMock('@pospay/observability', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), fatal: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }));
}

function mockStartupQueues(): void {
  vi.doMock('ioredis', () => ({
    Redis: class Redis {
      duplicate = () => new Redis();
      on() {}
      quit = vi.fn();
      disconnect = vi.fn();
      ping = vi.fn();
      set = vi.fn();
      del = vi.fn();
      get = vi.fn();
      evalsha = vi.fn();
    },
  }));
  vi.doMock('bullmq', () => ({
    Queue: class {
      on = vi.fn();
      waitUntilReady = async () => undefined;
      close = async () => undefined;
    },
    Worker: class {
      on = vi.fn();
      waitUntilReady = async () => undefined;
      close = async () => undefined;
    },
  }));
  vi.doMock('../../worker.ts', () => ({
    createWorker: async () => ({ listen: vi.fn(), enableShutdownHooks: vi.fn() }),
  }));
  vi.doMock('../dispatch-loop.ts', () => ({
    createDispatchLoop: () => ({ start: vi.fn(), stop: vi.fn() }),
  }));
}

function mockStartupModules(): void {
  vi.doMock('../deliver.ts', () => ({
    createDeliverer: (...args: unknown[]) => {
      const consumers = args[1] as { id: string; eventTypes: readonly string[] }[];
      const options = args[3] as { knownEventTypes: readonly string[] };
      registered.push({ consumers: [...consumers], known: options.knownEventTypes });
      return async () => ({ delivered: true });
    },
  }));
  vi.doMock('../../modules/files/index.ts', () => ({
    startFilesWorker: () => ({
      consumer: { id: 'files.upload', eventTypes: [] },
      deliver: vi.fn(),
      close: vi.fn(),
    }),
  }));
  vi.doMock('../../modules/customers/index.ts', async (original) => ({
    ...(await original<typeof CustomersModule>()),
    closedRatingClaimsLifecycle: () => ({ deliver: vi.fn(), close: vi.fn() }),
  }));
  vi.doMock('../../commission-reminders.ts', () => ({
    startCommissionReminderWiring: () => ({
      delivery: (event: unknown, next: (event: unknown) => Promise<unknown>) => next(event),
      readiness: vi.fn(),
      stop: vi.fn(),
      close: vi.fn(),
    }),
  }));
  vi.doMock('../../documents/start-documents.ts', () => ({
    startCoreBeforeDocuments: async (input: { startCore: () => Promise<void> }) => {
      await input.startCore();
      return { started: Promise.resolve(), close: async () => undefined, stop: async () => undefined };
    },
  }));
}

function mockStartupConfig(): void {
  vi.doMock('../../shared/config.ts', () => ({
    readConfig: () => ({
      DATABASE_URL: 'synthetic',
      DISPATCHER_DATABASE_URL: 'synthetic',
      REDIS_URL: 'synthetic',
      PLATFORM_NOTIFICATIONS_DATABASE_URL: 'synthetic',
      LOG_LEVEL: 'silent',
      WORKER_HOST: '127.0.0.1',
      WORKER_PORT: 3001,
      PACKAGE_SALE_TRANSACTION_TIMEOUT_MS: 30_000,
      PACKAGE_IMPORT_COMMIT_TRANSACTION_TIMEOUT_MS: 600_000,
    }),
  }));
}

it('registers the startup consumers and the known event types with the deliverer', async () => {
  vi.resetModules();
  mockStartupDataAndAuth();
  mockStartupQueues();
  mockStartupModules();
  mockStartupConfig();
  vi.stubEnv('NODE_ENV', 'production');
  await import('../../main.ts');
  expect(registered).toHaveLength(1);
  const startup = registered[0];
  if (startup === undefined) throw new Error('SYNTHETIC_STARTUP_MISSING');
  const covered = startup.consumers.flatMap((consumer) => consumer.eventTypes);
  expect(covered).toContain('LowRatingSubmitted');
  expect(covered).toContain('StaffAccessGranted');
  expect(covered).toContain('StaffPinSetByOther');
  expect(startup.consumers).toContainEqual(
    expect.objectContaining({ id: 'commissions.reminder-schedule' }),
  );
  expect(startup.known.length).toBeGreaterThan(0);
});
