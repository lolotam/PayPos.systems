import type { PermissionMembership } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PermissionsPage } from './permissions-page';

// jsdom لا يطبق التمرير والتقاط المؤشر اللذين يحتاجهما Select الحقيقي عند فتح القائمة.
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../ui/business-discount-default', () => ({ BusinessDiscountDefault: () => null }));

const membership: PermissionMembership = {
  id: '01920000-0000-7000-8000-0000000000a1',
  user_id: '01920000-0000-7000-8001-0000000000a1',
  employee_id: null,
  role_code: 'viewer',
  role_name_ar: null,
  role_name_en: 'Viewer',
  scope_type: 'COMPANY',
  scope_id: '01920000-0000-7000-8000-0000000000a2',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: null,
};

vi.mock('../api/use-permissions', () => ({
  usePermissionMemberships: () => ({
    isPending: false,
    isFetching: false,
    isError: false,
    failureCount: 0,
    failureReason: null,
    error: null,
    data: { items: [membership], next_cursor: null },
  }),
}));

function renderPage() {
  return render(
    <PermissionsPage
      companyId="01920000-0000-7000-8000-0000000000a0"
      userId="01920000-0000-7000-8000-0000000000a0"
      branchTimeZones={{}}
      scopeNames={{}}
      business={{ id: '01920000-0000-7000-8000-0000000000b0', name: 'Synthetic business' }}
    />,
  );
}

function cardOf(element: HTMLElement) {
  return element.closest('.rounded-card') as HTMLElement;
}

function follows(a: Node, b: Node) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

it('puts the members table and its paging in one card, in that order, under the heading', () => {
  renderPage();
  const table = screen.getByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'permissions.title') });
  const next = within(card).getByRole('button', { name: t('en', 'permissions.next') });
  expect(follows(table, next)).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell that has content and leaves the title and the action cells without a label', () => {
  renderPage();
  expect(
    screen.getByRole('table').closest('[class*="max-[599.99px]:[&_table]:block"]'),
  ).not.toBeNull();
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const labels = within(row)
    .getAllByRole('cell')
    .map((cell) => cell.getAttribute('data-cell-label'));
  expect(labels).toEqual([
    null,
    t('en', 'permissions.role'),
    t('en', 'permissions.scope'),
    null,
  ]);
});
