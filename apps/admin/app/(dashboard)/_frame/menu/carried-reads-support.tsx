import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

import { carriedApi, REF } from './carried-mocks';
import { VisibleIdsProbe } from './visible-ids-probe';

export function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** يرسم القوائم بالقراءات الحقيقية ويعيد العميل والعرض ودالة إعادة الرسم. */
export function renderVisible(client: QueryClient = newClient()) {
  const tree = () => (
    <QueryClientProvider client={client}>
      <VisibleIdsProbe />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, ...view, rerenderVisible: () => view.rerender(tree()) };
}

export const isListed = (id: string): boolean => screen.queryByText(id) !== null;

/** ينتظر ظهور الصفحة في القوائم. */
export async function expectListed(id: string): Promise<void> {
  expect(await screen.findByText(id)).toBeTruthy();
}

/** ينتظر انتهاء كل القراءات الجارية ثم يتأكد أن الصفحة غائبة. */
export async function expectHiddenOnceSettled(client: QueryClient, id: string): Promise<void> {
  await waitFor(() => expect(carriedApi.GET).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(isListed(id)).toBe(false);
}

/** ترويسة الشركة ومعرّف النشاط في الطلب، كما تقرؤهما صفحة المدخل القديمة. */
export function readParams() {
  return expect.objectContaining({
    params: expect.objectContaining({
      header: { 'x-company-id': REF },
      path: { businessId: REF },
    }),
  });
}

export const refusalAnswer = (status: number) => ({
  error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
  response: { status },
});
