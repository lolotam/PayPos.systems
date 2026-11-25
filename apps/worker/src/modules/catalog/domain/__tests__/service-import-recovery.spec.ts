import { expect, it } from 'vitest';
import {
  SERVICE_IMPORT_COMMIT_STALE_MS,
  SERVICE_IMPORT_RECOVERY_MAX_PAGES,
  serviceImportCommitStaleBefore,
} from '../service-import-recovery.ts';

// الحد شامل عند المستهلك (requested_at <= before): الطلب المقبول عند هذه اللحظة بالضبط يدخل المسح، وحدّه الفعلي تثبته اختبارات قاعدة البيانات.
it('counts staleness from exactly ten minutes back', () => {
  expect(serviceImportCommitStaleBefore(new Date('2026-11-22T12:00:00Z')).toISOString()).toBe(
    '2026-11-22T11:50:00.000Z',
  );
});

it('keeps the stale window at ten minutes and the sweep at twenty pages', () => {
  expect(SERVICE_IMPORT_COMMIT_STALE_MS).toBe(10 * 60 * 1000);
  expect(SERVICE_IMPORT_RECOVERY_MAX_PAGES).toBe(20);
});
