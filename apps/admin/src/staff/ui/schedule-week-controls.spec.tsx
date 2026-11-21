import { t, type Locale } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScheduleWeekControls } from './schedule-week-controls';

const state = vi.hoisted<{ locale: Locale }>(() => ({ locale: 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

describe('ScheduleWeekControls', () => {
  it.each<Locale>(['en', 'ar'])(
    'labels the reload button with schedules.reload instead of staff.reload (%s)',
    (locale) => {
      state.locale = locale;
      render(
        <ScheduleWeekControls
          week="2026-11-21"
          timezone="Asia/Kuwait"
          fetching={false}
          onWeek={vi.fn()}
          onReload={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: t(locale, 'schedules.reload') })).toBeTruthy();
      expect(screen.queryByRole('button', { name: t(locale, 'staff.reload') })).toBeNull();
    },
  );
});
