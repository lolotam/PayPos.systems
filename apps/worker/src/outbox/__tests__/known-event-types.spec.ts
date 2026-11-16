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
vi.mock('../../modules/catalog/jobs/service-category-closing.processor.ts', () => ({
  startServiceCategoryClosingProcessor: () => ({
    ready: async () => undefined,
    close: async () => undefined,
    deliver: async () => ({ delivered: true }),
  }),
}));
import { startCatalogWorker } from '../../modules/catalog/index.ts';
import { startPackagePreviewWorker, startPackageSaleWorker } from '../../modules/orders/index.ts';
import type { Database } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { expect, it, vi } from 'vitest';

import {
  createNotificationModule,
  createInAppNotificationModule,
} from '../../modules/notifications/index.ts';
import { createStaffDocumentDefaults, startStaffWorker } from '../../modules/staff/index.ts';
import { createDeliverer } from '../deliver.ts';
import { KNOWN_EVENT_TYPES, knownEventTypes } from '../known-event-types.ts';
import { emittedEventTypes } from './emitted-event-types.ts';
import { retryDelayMs } from '../retry-policy.ts';

// نعزل اتصالات الطوابير فقط؛ قوائم الأنواع والمستهلكون تأتي من تركيب الوحدات الحقيقي.
vi.mock('../../modules/staff/jobs/missed-out.processor.ts', () => ({
  startMissedOutProcessor: () => ({}),
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
const catalog = startCatalogWorker(database, ids, 'synthetic', clock);

it('recognizes every event emitted by API and worker, including finite template expansions', () => {
  const emitted = emittedEventTypes();
  const consumers = [notifications.consumer, createStaffDocumentDefaults(ids)];
  const supported = new Set([
    ...knownEventTypes(staff, notifications, null, previews, sales, catalog),
    ...consumers.flatMap((consumer) => consumer.eventTypes),
  ]);
  expect(catalog.eventTypes).toContain('ServiceCategoryClosingRequested');
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
