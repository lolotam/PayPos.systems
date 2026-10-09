import { t } from '@pospay/i18n';
import { findGccBank } from '@pospay/domain';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IbanHistoryTable } from './iban-history-table';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'ar' }));
it('renders grouped LTR accounts, translated bank names, actors, reasons and clearing entries', () => {
  const common = {
    set_at: '2026-10-09T12:00:00.000Z',
    set_by: '01920000-0000-7000-8000-0000000000a2',
    reason: 'Synthetic reason',
  };
  render(
    <IbanHistoryTable
      items={[
        { ...common, revision: 2, cleared: true, iban: null, bank_id: null, holder_name_en: null },
        {
          ...common,
          revision: 1,
          cleared: false,
          iban: 'KW81CBKU0000000000001234560101',
          bank_id: 'kw-cbk',
          holder_name_en: 'SYNTHETIC HOLDER',
        },
      ]}
    />,
  );
  expect(screen.getByText('KW81 CBKU 0000 0000 0000 1234 5601 01').getAttribute('dir')).toBe('ltr');
  expect(screen.getByText(findGccBank('kw-cbk')?.nameAr ?? '')).toBeTruthy();
  expect(screen.getByText(t('ar', 'employeeIban.cleared'))).toBeTruthy();
  expect(screen.getAllByText(common.set_by)).toHaveLength(2);
});
