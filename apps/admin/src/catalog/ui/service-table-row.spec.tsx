import type { ServiceListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceTableRow } from './service-table-row';

const localeState = vi.hoisted(() => ({ selected: 'en' as Locale }));

vi.mock('@/shared/locale/locale-context', () => ({
  useLocale: () => localeState.selected,
}));

const serviceId = '01920000-0000-7000-8000-0000000000a1';

function makeService(overrides: Partial<ServiceListItem> = {}): ServiceListItem {
  return {
    id: serviceId,
    name_en: 'Facial Care',
    name_ar: 'Facial Care (ar)',
    price: '15.000',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 60,
    category_id: null,
    category: null,
    closed_at: null,
    revision: 1,
    ...overrides,
  };
}

function renderRow(item: ServiceListItem) {
  return render(
    <table>
      <tbody>
        <ServiceTableRow item={item} selected={false} onSelect={vi.fn()} />
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  localeState.selected = 'en';
});

it('does not show the closed badge when closed_at is null (open service)', () => {
  const openService = makeService({ closed_at: null });
  renderRow(openService);

  expect(screen.getByText('Facial Care')).toBeTruthy();
  expect(screen.queryByText(t('en', 'catalogServiceCategories.closed'))).toBeNull();
});

it.each(['en', 'ar'] as const)(
  'renders bilingual service name and closed badge in %s',
  (locale) => {
    localeState.selected = locale;
    const closedService = makeService({ closed_at: '2026-10-05T10:00:00Z' });
    renderRow(closedService);

    const expectedName = locale === 'ar' ? 'Facial Care (ar)' : 'Facial Care';
    const nameSpan = screen.getByText(expectedName);
    const container = nameSpan.parentElement;
    if (!container) throw new Error('container not found');

    expect(within(container).getByText(t(locale, 'catalogServiceCategories.closed'))).toBeTruthy();
  },
);
