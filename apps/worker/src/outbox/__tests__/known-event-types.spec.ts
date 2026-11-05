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

it('recognizes every event emitted by API and worker, including finite template expansions', () => {
  const emitted = emittedEventTypes();
  const consumers = [notifications.consumer, createStaffDocumentDefaults(ids)];
  const supported = new Set([
    ...knownEventTypes(staff, notifications, null),
    ...consumers.flatMap((consumer) => consumer.eventTypes),
  ]);
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
  // ADR-0010: منتج المعاينة مقفول بـ404 لحد مستهلك 47-1b؛ يفضل مجهولًا عشان العامل القديم يعيد المحاولة.
  const fencedProducers = new Set(['PackageImportPreviewRequested']);
  expect(
    [...emitted].filter(
      ([eventType]) => !supported.has(eventType) && !fencedProducers.has(eventType),
    ),
  ).toEqual([]);
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

it('retries a package preview request until the 47-1b consumer exists', async () => {
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
