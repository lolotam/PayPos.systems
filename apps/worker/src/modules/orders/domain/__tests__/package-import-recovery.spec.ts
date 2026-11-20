import { expect, it } from 'vitest';
import {
  PACKAGE_IMPORT_COMMIT_STALE_MS,
  packageImportCommitStaleBefore,
  packageImportCommitWindowClosed,
} from '../package-import-recovery.ts';

// الحد شامل عند المستهلك (requested_at <= before): الطلب المقبول عند هذه اللحظة بالضبط يدخل المسح، وحدّه الفعلي تثبته اختبارات قاعدة البيانات.
it('counts staleness from exactly ten minutes back', () => {
  expect(packageImportCommitStaleBefore(new Date('2026-11-05T12:00:00Z')).toISOString()).toBe(
    '2026-11-05T11:50:00.000Z',
  );
});

// الحد شامل: عند العشر دقائق بالضبط يصير المسح صاحب القرار، وقبله بميلي ثانية ما زالت المحاولة مسموحة.
it.each([
  { elapsed: PACKAGE_IMPORT_COMMIT_STALE_MS - 1, closed: false },
  { elapsed: PACKAGE_IMPORT_COMMIT_STALE_MS, closed: true },
  { elapsed: PACKAGE_IMPORT_COMMIT_STALE_MS + 1, closed: true },
])('window closed is $closed when $elapsed ms passed since enqueue', ({ elapsed, closed }) => {
  const enqueuedAt = Date.UTC(2026, 10, 5, 12, 0, 0);
  expect(packageImportCommitWindowClosed(enqueuedAt, enqueuedAt + elapsed)).toBe(closed);
});
