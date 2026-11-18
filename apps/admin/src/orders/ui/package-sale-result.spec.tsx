import { parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageSaleResult } from './package-sale-result';
import { completedPackageSale } from './package-sale-status.fixture';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it.each(['ar', 'en'] as const)(
  'shows the localized stale quote and structured current revisions in %s',
  (locale) => {
    state.locale = locale;
    const details = {
      current_service_revisions: [
        { service_id: '01920000-0000-7000-8000-000000000036', revision: 5 },
      ],
    };
    render(
      <PackageSaleResult
        status={{
          status: 'failed',
          error: {
            code: 'PACKAGE_SALE_QUOTE_STALE',
            message_ar: 'Stale AR',
            message_en: 'Stale EN',
            details,
          },
        }}
        timedOut={false}
        recheck={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(locale === 'ar' ? 'Stale AR' : 'Stale EN');
    expect(alert.textContent).toContain(JSON.stringify(details));
    expect(alert.textContent).toContain(t(locale, 'packageSale.details'));
  },
);

it.each(['ar', 'en'] as const)(
  'shows formatted server amounts and the exact expiry date in %s',
  (locale) => {
    state.locale = locale;
    render(<PackageSaleResult status={completedPackageSale} timedOut={false} recheck={vi.fn()} />);
    const summary = screen.getByRole('status');
    const entitlement = completedPackageSale.entitlement;
    expect(summary.textContent).toContain(formatKwd(parseMoney(entitlement.price_paid)));
    expect(summary.textContent).toContain(formatKwd(parseMoney(entitlement.discount)));
    expect(summary.textContent).toContain(entitlement.expires_on);
    expect(summary.textContent).toContain(t(locale, 'packageSale.completed'));
    expect(summary.textContent).toContain('1,234.500');
  },
);

it('offers a visible status-only recheck after the pending timeout', () => {
  const recheck = vi.fn();
  render(<PackageSaleResult status={{ status: 'pending' }} timedOut recheck={recheck} />);
  expect(screen.getByRole('status').textContent).toContain(t('en', 'packageSale.timeout'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.recheck') }));
  expect(recheck).toHaveBeenCalledTimes(1);
});
