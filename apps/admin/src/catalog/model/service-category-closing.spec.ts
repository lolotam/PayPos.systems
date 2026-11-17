import {
  SERVICE_CATEGORY_CLOSING_FAILURE_CODES,
  type ServiceCategoryClosingStatus,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { closingView, formatCount } from './service-category-closing';

const closingId = '01920000-0000-7000-8000-0000000000c1';
const categoryId = '01920000-0000-7000-8000-0000000000c2';

function statusRecord(
  overrides: Partial<ServiceCategoryClosingStatus> = {},
): ServiceCategoryClosingStatus {
  return {
    closing_id: closingId,
    category_id: categoryId,
    action: 'close',
    status: 'pending',
    services_changed: null,
    error_code: null,
    requested_at: '2026-10-05T10:00:00Z',
    finished_at: null,
    ...overrides,
  };
}

it('maps a synchronous 200 done mutation result for close and reopen', () => {
  expect(closingView({ kind: 'done', action: 'close', servicesChanged: 450 })).toEqual({
    tone: 'done',
    key: 'catalogServiceCategories.closedWithCount',
    count: 450,
  });
  expect(closingView({ kind: 'done', action: 'reopen', servicesChanged: 12 })).toEqual({
    tone: 'done',
    key: 'catalogServiceCategories.reopenedWithCount',
    count: 12,
  });
});

it('maps a 202 pending mutation result for close and reopen', () => {
  expect(closingView({ kind: 'pending', action: 'close', closingId })).toEqual({
    tone: 'pending',
    key: 'catalogServiceCategories.closing',
  });
  expect(closingView({ kind: 'pending', action: 'reopen', closingId })).toEqual({
    tone: 'pending',
    key: 'catalogServiceCategories.reopening',
  });
});

it('maps a status query read that is pending', () => {
  expect(closingView(statusRecord({ action: 'close', status: 'pending' }))).toEqual({
    tone: 'pending',
    key: 'catalogServiceCategories.closing',
  });
  expect(closingView(statusRecord({ action: 'reopen', status: 'pending' }))).toEqual({
    tone: 'pending',
    key: 'catalogServiceCategories.reopening',
  });
  expect(closingView({ action: 'close', status: 'pending' })).toEqual({
    tone: 'pending',
    key: 'catalogServiceCategories.closing',
  });
});

it('maps a status query read that is completed with services_changed', () => {
  expect(
    closingView(
      statusRecord({
        action: 'close',
        status: 'completed',
        services_changed: 450,
        finished_at: '2026-10-05T10:00:05Z',
      }),
    ),
  ).toEqual({
    tone: 'done',
    key: 'catalogServiceCategories.closedWithCount',
    count: 450,
  });
  expect(
    closingView(
      statusRecord({
        action: 'reopen',
        status: 'completed',
        services_changed: 12,
        finished_at: '2026-10-05T10:00:05Z',
      }),
    ),
  ).toEqual({
    tone: 'done',
    key: 'catalogServiceCategories.reopenedWithCount',
    count: 12,
  });
  expect(
    closingView(
      statusRecord({
        action: 'close',
        status: 'completed',
        services_changed: null,
        finished_at: '2026-10-05T10:00:05Z',
      }),
    ),
  ).toEqual({
    tone: 'done',
    key: 'catalogServiceCategories.closedWithCount',
    count: 0,
  });
});

it.each(SERVICE_CATEGORY_CLOSING_FAILURE_CODES)(
  'maps a status query read that is failed with %s',
  (errorCode) => {
    expect(
      closingView(
        statusRecord({
          status: 'failed',
          error_code: errorCode,
          finished_at: '2026-10-05T10:00:05Z',
        }),
      ),
    ).toEqual({
      tone: 'failed',
      errorCode,
    });
  },
);

it('falls back to SERVICE_CATEGORY_CLOSING_FAILED when failed status has null error_code', () => {
  expect(
    closingView(
      statusRecord({
        status: 'failed',
        error_code: null,
        finished_at: '2026-10-05T10:00:05Z',
      }),
    ),
  ).toEqual({
    tone: 'failed',
    errorCode: 'SERVICE_CATEGORY_CLOSING_FAILED',
  });
});

it('pins the SI-Q30 Arabic copy for closing and closedWithCount', () => {
  expect(t('ar', 'catalogServiceCategories.closing')).toBe('جاري القفل…');
  expect(formatCount(t('ar', 'catalogServiceCategories.closedWithCount'), 450)).toBe(
    'اتقفل التصنيف و450 خدمة',
  );
});

it('replaces single and multiple occurrences of {count}', () => {
  expect(formatCount('Closed {count} services.', 450)).toBe('Closed 450 services.');
  expect(formatCount('{count} open, {count} closed', 3)).toBe('3 open, 3 closed');
  expect(formatCount('Zero count: {count}', 0)).toBe('Zero count: 0');
  expect(formatCount('No placeholder', 42)).toBe('No placeholder');
});
