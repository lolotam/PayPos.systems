import { t } from '@pospay/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, it, vi } from 'vitest';
import { expectOneWrappingRow } from '@/shared/ui/filter-row.helpers';
import { RatingsFiltersBar } from './ratings-filters';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

afterEach(cleanup);

it('keeps the ratings month, branch and employee filters in one wrapping row', () => {
  render(
    <RatingsFiltersBar
      filters={{ month: '2026-11', branchId: '', employeeId: '' }}
      branches={[]}
      employees={[]}
      onChange={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'ratings.month')),
    screen.getByLabelText(t('en', 'ratings.branch')),
    screen.getByLabelText(t('en', 'ratings.employee')),
  ]);
});
