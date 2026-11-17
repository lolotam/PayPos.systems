import type { ServiceCategoryDetail, ServiceCategoryListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Mock } from 'vitest';
import { ServiceCategoriesPage } from './service-categories-page';

export const companyId = '01920000-0000-7000-8000-000000000001';
export const businessId = '01920000-0000-7000-8000-000000000002';
export const userId = '01920000-0000-7000-8000-000000000003';
export const categoryAId = '01920000-0000-7000-8000-0000000000a1';
export const categoryBId = '01920000-0000-7000-8000-0000000000b1';
export const categoryCId = '01920000-0000-7000-8000-0000000000c1';
export const closingId = '01920000-0000-7000-8000-000000000099';
export const closingBId = '01920000-0000-7000-8000-000000000098';

export const categoryA: ServiceCategoryListItem = {
  id: categoryAId,
  name_en: 'Category A',
  name_ar: 'Category A (ar)',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};

export const categoryB: ServiceCategoryListItem = {
  id: categoryBId,
  name_en: 'Category B',
  name_ar: 'Category B (ar)',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};

export const closedCategoryC: ServiceCategoryListItem = {
  id: categoryCId,
  name_en: 'Category C',
  name_ar: 'Category C (ar)',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: '2026-10-05T10:00:00Z',
  revision: 1,
};

export const detailA: ServiceCategoryDetail = {
  ...categoryA,
  open_service_count: 450,
  marked_service_count: 0,
  pending_closing_id: null,
};

export const detailB: ServiceCategoryDetail = {
  ...categoryB,
  open_service_count: 20,
  marked_service_count: 0,
  pending_closing_id: null,
};

export const detailC: ServiceCategoryDetail = {
  ...closedCategoryC,
  open_service_count: 0,
  marked_service_count: 12,
  pending_closing_id: null,
};

export const pendingStatus = {
  closing_id: closingId,
  category_id: categoryAId,
  action: 'close' as const,
  status: 'pending' as const,
  services_changed: null,
  error_code: null,
  requested_at: '2026-10-05T10:00:00Z',
  finished_at: null,
};

export const completedStatus = {
  ...pendingStatus,
  status: 'completed' as const,
  services_changed: 450,
  finished_at: '2026-10-05T10:00:05Z',
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderPage(locale: Locale = 'en', client: QueryClient = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <ServiceCategoriesPage
          companyId={companyId}
          business={{ id: businessId, name_en: 'Business', name_ar: null, branches: [] }}
          userId={userId}
        />
      </div>
    </QueryClientProvider>,
  );
}

export function findRow(name: string): HTMLElement {
  const matches = screen.getAllByText(name);
  const inRow = matches.find((el) => el.closest('tr'));
  const row = inRow?.closest('tr');
  if (!row) throw new Error('row not found: ' + name);
  return row;
}

export async function findPanel(locale: Locale = 'en'): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', {
    name: t(locale, 'catalogServiceCategories.detailTitle'),
  });
  const panel = (heading.closest('div.p-6') ??
    heading.parentElement?.parentElement) as HTMLElement | null;
  if (!panel) throw new Error('panel not found');
  return panel;
}

export function selectRow(name: string, locale: Locale = 'en'): void {
  const row = findRow(name);
  const btn = within(row).getByRole('button', {
    name: t(locale, 'catalogServiceCategories.manage'),
  });
  fireEvent.click(btn);
}

export function setupCategoriesGet(
  get: Mock,
  options: { categoryAClosed?: boolean; detailACount?: number } = {},
) {
  get.mockImplementation(
    (
      path: string,
      req?: { params?: { path?: { categoryId?: string }; query?: { status?: string } } },
    ) => {
      if (path === '/v1/businesses/{businessId}/service-categories') {
        const status = req?.params?.query?.status ?? 'open';
        if (status === 'closed') {
          const items = options.categoryAClosed
            ? [{ ...categoryA, closed_at: '2026-10-05T10:00:00Z' }, closedCategoryC]
            : [closedCategoryC];
          return Promise.resolve({ data: { items, next_cursor: null }, response: { status: 200 } });
        }
        const openA = options.categoryAClosed ? [] : [categoryA];
        return Promise.resolve({
          data: { items: [...openA, categoryB], next_cursor: null },
          response: { status: 200 },
        });
      }
      const categoryId = req?.params?.path?.categoryId;
      if (categoryId === categoryAId) {
        const data = options.categoryAClosed
          ? {
              ...detailA,
              closed_at: '2026-10-05T10:00:00Z',
              open_service_count: 0,
              marked_service_count: 450,
            }
          : { ...detailA, open_service_count: options.detailACount ?? detailA.open_service_count };
        return Promise.resolve({ data, response: { status: 200 } });
      }
      if (categoryId === categoryBId)
        return Promise.resolve({ data: detailB, response: { status: 200 } });
      if (categoryId === categoryCId)
        return Promise.resolve({ data: detailC, response: { status: 200 } });
      return Promise.resolve({ data: {}, response: { status: 200 } });
    },
  );
}

export function setupClosingFlowGet(get: Mock, isClosed: () => boolean) {
  get.mockImplementation(
    (
      path: string,
      req?: { params?: { path?: { categoryId?: string }; query?: { status?: string } } },
    ) => {
      const aClosed = isClosed();
      const closedA = { ...categoryA, closed_at: '2026-10-05T10:00:00Z' };
      if (path === '/v1/businesses/{businessId}/service-categories') {
        const status = req?.params?.query?.status ?? 'open';
        const items =
          status === 'closed'
            ? [...(aClosed ? [closedA] : []), closedCategoryC]
            : [...(aClosed ? [] : [categoryA]), categoryB];
        return Promise.resolve({ data: { items, next_cursor: null }, response: { status: 200 } });
      }
      if (path.includes('/closings/')) {
        const data =
          req?.params?.path?.categoryId === categoryBId
            ? { ...pendingStatus, closing_id: closingBId, category_id: categoryBId }
            : aClosed
              ? completedStatus
              : pendingStatus;
        return Promise.resolve({ data, response: { status: 200 } });
      }
      if (req?.params?.path?.categoryId === categoryAId) {
        const data = aClosed
          ? { ...detailA, closed_at: '2026-10-05T10:00:00Z', open_service_count: 0 }
          : detailA;
        return Promise.resolve({ data, response: { status: 200 } });
      }
      if (req?.params?.path?.categoryId === categoryBId) {
        return Promise.resolve({ data: detailB, response: { status: 200 } });
      }
      return Promise.resolve({ data: {}, response: { status: 200 } });
    },
  );
}

export function setupReopenFlowGet(get: Mock) {
  get.mockImplementation(
    (
      path: string,
      req?: { params?: { path?: { categoryId?: string }; query?: { status?: string } } },
    ) => {
      if (path === '/v1/businesses/{businessId}/service-categories') {
        const status = req?.params?.query?.status ?? 'open';
        const items = status === 'closed' ? [closedCategoryC] : [categoryA, categoryB];
        return Promise.resolve({ data: { items, next_cursor: null }, response: { status: 200 } });
      }
      if (path.includes('/closings/')) {
        return Promise.resolve({
          data: {
            closing_id: closingId,
            category_id: categoryCId,
            action: 'reopen',
            status: 'completed',
            services_changed: 12,
            error_code: null,
            requested_at: '2026-10-05T10:00:00Z',
            finished_at: '2026-10-05T10:00:05Z',
          },
          response: { status: 200 },
        });
      }
      if (req?.params?.path?.categoryId === categoryCId) {
        return Promise.resolve({ data: detailC, response: { status: 200 } });
      }
      return Promise.resolve({ data: {}, response: { status: 200 } });
    },
  );
}

export function setupFailedJobGet(get: Mock, getDetailCount: () => number) {
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA, categoryB], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (path.includes('/closings/')) {
      const failData = {
        ...pendingStatus,
        status: 'failed' as const,
        error_code: 'SERVICE_CATEGORY_COUNT_CHANGED' as const,
        finished_at: '2026-10-05T10:00:05Z',
      };
      return Promise.resolve({ data: failData, response: { status: 200 } });
    }
    if (req?.params?.path?.categoryId === categoryAId) {
      return Promise.resolve({
        data: { ...detailA, open_service_count: getDetailCount() },
        response: { status: 200 },
      });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
}

export function setupRace1Get(get: Mock) {
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA, categoryB], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (path.includes('/closings/'))
      return Promise.resolve({ data: completedStatus, response: { status: 200 } });
    if (req?.params?.path?.categoryId === categoryAId) {
      return Promise.resolve({
        data: { ...detailA, pending_closing_id: closingId },
        response: { status: 200 },
      });
    }
    if (req?.params?.path?.categoryId === categoryBId)
      return Promise.resolve({ data: detailB, response: { status: 200 } });
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
}

export function setupCreateCategoryMocks(get: Mock, post: Mock, createdId: string) {
  const createdDetail: ServiceCategoryDetail = {
    id: createdId,
    name_en: 'Spa',
    name_ar: 'Spa (ar)',
    visibility: 'BUSINESS',
    owner_branch_id: null,
    closed_at: null,
    revision: 1,
    open_service_count: 0,
    marked_service_count: 0,
    pending_closing_id: null,
  };
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({ data: { items: [], next_cursor: null }, response: { status: 200 } });
    }
    if (req?.params?.path?.categoryId === createdId) {
      return Promise.resolve({ data: createdDetail, response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });
  post.mockResolvedValueOnce({
    data: {
      id: createdId,
      name_en: 'Spa',
      name_ar: 'Spa (ar)',
      visibility: 'BUSINESS',
      owner_branch_id: null,
      closed_at: null,
      revision: 1,
    },
    response: { status: 200 },
  });
}
