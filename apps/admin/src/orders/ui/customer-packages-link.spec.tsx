import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerPackagesLink } from './customer-packages-link';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000e1';
const label = t('en', 'customerPackages.open');

function renderLink(newTab: boolean) {
  return render(
    <DirectionProvider dir="ltr">
      <CustomerPackagesLink customerId={id} newTab={newTab} />
    </DirectionProvider>,
  );
}

describe('CustomerPackagesLink', () => {
  it('points at the generic packages address of the customer', () => {
    renderLink(false);
    const link = screen.getByRole('link', { name: label });
    expect(link.getAttribute('href')).toBe(`/orders/customers/${id}/packages`);
    expect(link.getAttribute('target')).toBeNull();
  });

  it('opens a new tab when the caller asks for it', () => {
    renderLink(true);
    const link = screen.getByRole('link', { name: label });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('never carries the customer name or the phone in the address', () => {
    renderLink(false);
    const href = screen.getByRole('link', { name: label }).getAttribute('href') ?? '';
    expect(href).not.toMatch(/name|phone/i);
  });
});
