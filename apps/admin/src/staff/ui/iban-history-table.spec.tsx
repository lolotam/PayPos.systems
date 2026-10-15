import { findGccBank } from '@pospay/domain';
import { formatInstant, t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IbanHistoryTable } from './iban-history-table';

const state = vi.hoisted(() => ({ locale: 'ar' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const columns = [
  'employeeIban.revision',
  'employeeIban.iban',
  'employeeIban.bank',
  'employeeIban.holder',
  'employeeIban.reason',
  'employeeIban.date',
] as const;

const common = {
  set_at: '2026-10-09T12:00:00.000Z',
  set_by: '01920000-0000-7000-8000-0000000000a2',
  reason: 'Synthetic reason',
};

it.each(['ar', 'en'] as const)(
  'renders IBAN history without an actor column in %s',
  (locale) => {
    state.locale = locale;
    render(
      <IbanHistoryTable
        items={[
          {
            ...common,
            revision: 2,
            cleared: true,
            iban: null,
            bank_id: null,
            holder_name_en: null,
          },
          {
            ...common,
            revision: 1,
            cleared: false,
            iban: 'KW81CBKU0000000000001234560101',
            bank_id: 'kw-cbk',
            holder_name_en: 'SYNTHETIC HOLDER',
          },
        ]}
        timeZone="Asia/Kuwait"
      />,
    );
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(
      columns.map((key) => t(locale, key)),
    );
    expect(screen.queryByText(common.set_by, { exact: false })).toBeNull();
    const bank = findGccBank('kw-cbk');
    expect(screen.getByText((locale === 'ar' ? bank?.nameAr : bank?.nameEn) ?? '')).toBeTruthy();
    expect(screen.getByText('KW81 CBKU 0000 0000 0000 1234 5601 01').getAttribute('dir')).toBe(
      'ltr',
    );
    expect(screen.getByText(t(locale, 'employeeIban.cleared'))).toBeTruthy();
    expect(screen.getByText('SYNTHETIC HOLDER')).toBeTruthy();
    expect(screen.getAllByText(common.reason)).toHaveLength(2);
    // الوقت بتوقيت فرع الموظفة مش UTC (CLAUDE.md §5).
    const branchTime = formatInstant(new Date(common.set_at), locale, 'Asia/Kuwait');
    expect(branchTime).not.toBe(formatInstant(new Date(common.set_at), locale, 'UTC'));
    expect(screen.getAllByText(branchTime)).toHaveLength(2);
  },
);
