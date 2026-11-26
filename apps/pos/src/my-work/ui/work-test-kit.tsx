import { fireEvent, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import {
  installFetch,
  json,
  renderWithProviders,
  replaceFetch,
  type Locale,
  type Route,
} from '@/shared/testing/query-kit';

export { installFetch, json, replaceFetch };
export type { Route };

/** يرندر شاشة جوّا client جديد ولغة محددة، ويرجّع الـ client عشان نفحص الكاش. */
export function renderWork(
  ui: ReactNode,
  locale: Locale = 'en',
  client: QueryClient = new QueryClient(),
) {
  const view = renderWithProviders(ui, locale, client);
  return { ...view, rerenderWork: view.rerenderWithProviders };
}

export const myWorkEntries = (client: QueryClient) =>
  client.getQueryCache().findAll({ queryKey: ['my-work'] });

// بعد ما الشاشة تتقفل مفيش حاجة جواها، فالإدخال بيروح على الصفحة نفسها زي ما بيحصل فعلاً.
const insideMyWork = () =>
  screen.queryByRole('button', { name: t('en', 'myWork.previousMonth') }) ?? document.body;
/** كتابة جوّا «شغلي» المفتوحة (على زر الشهر السابق اللي في حاوية العرض الخاص): ده الإدخال اللي بيتحسب. */
export const typeInMyWork = (key = 'a') => fireEvent.keyDown(insideMyWork(), { key });
/** لمسة بالمؤشر جوّا «شغلي» المفتوحة. */
export const pointInMyWork = () => fireEvent.pointerDown(insideMyWork());
