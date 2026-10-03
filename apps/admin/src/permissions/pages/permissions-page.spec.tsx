import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { expect, it, vi } from 'vitest';
import { PermissionsPage } from './permissions-page';

// jsdom لا يطبق التمرير والتقاط المؤشر اللذين يحتاجهما Select الحقيقي عند فتح القائمة.
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', list: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-permissions', () => ({
  usePermissionMemberships: (...args: unknown[]) => {
    state.list(...args);
    return { isPending: false, isError: false, data: { items: [], next_cursor: null } };
  },
}));
vi.mock('../ui/business-discount-default', () => ({ BusinessDiscountDefault: () => null }));

it.each(['ar', 'en'] as const)(
  'keeps company management reachable with a selected business in %s',
  async (locale) => {
    state.locale = locale;
    state.list.mockClear();
    const companyId = '01920000-0000-7000-8000-0000000000a0';
    const businessId = '01920000-0000-7000-8000-0000000000b0';
    render(
      <PermissionsPage
        companyId={companyId}
        userId={companyId}
        branchTimeZones={{}}
        scopeNames={{}}
        business={{ id: businessId, name: 'Synthetic business' }}
      />,
    );
    expect(state.list).toHaveBeenLastCalledWith(companyId, companyId, undefined, businessId);
    fireEvent.keyDown(screen.getByRole('combobox', { name: t(locale, 'permissions.scope') }), {
      key: 'ArrowDown',
    });
    fireEvent.click(await screen.findByRole('option', { name: t(locale, 'permissions.company') }));
    await waitFor(() =>
      expect(state.list).toHaveBeenLastCalledWith(companyId, companyId, undefined, undefined),
    );
  },
);
