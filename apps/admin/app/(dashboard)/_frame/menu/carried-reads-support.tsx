import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { t, type MessageKey } from '@pospay/i18n';
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

/** مدخل في القائمة كما يراه المستخدم: اسمه (مفتاح الترجمة) وعنوانه. */
export interface MenuEntry {
  label: MessageKey;
  href: string;
}

const linkOf = (entry: MenuEntry) => screen.queryByRole('link', { name: t('en', entry.label) });

export const isListed = (entry: MenuEntry): boolean => linkOf(entry) !== null;

/** ينتظر ظهور المدخل في القوائم باسمه وعنوانه. */
export async function expectListed(entry: MenuEntry): Promise<void> {
  const link = await screen.findByRole('link', { name: t('en', entry.label) });
  expect(link.getAttribute('href')).toBe(entry.href);
}

/** ينتظر انتهاء كل القراءات الجارية ثم يتأكد أن المدخل غائب. */
export async function expectHiddenOnceSettled(client: QueryClient, entry: MenuEntry): Promise<void> {
  await waitFor(() => expect(carriedApi.GET).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(isListed(entry)).toBe(false);
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
