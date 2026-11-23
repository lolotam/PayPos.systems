import { fireEvent, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';

export type Route = (request: Request, url: URL) => Response | undefined;

// العميل المشترك لجهاز الاستقبال بيمسك الـ fetch وقت إنشائه، فنفس الدالة لازم تفضل مركّبة بين الاختبارات.
let current: (request: Request) => Promise<Response> = async () => Response.error();
const stable = (request: Request) => current(request);

/** يحط fetch مزيف: الطلبات بتتسجل والرد بييجي من الـ route، وغير كده 404. */
export function installFetch(route: Route) {
  const requests: Request[] = [];
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  current = async (request) => {
    requests.push(request);
    return (
      route(request, new URL(request.url)) ?? Response.json({ code: 'NOT_FOUND' }, { status: 404 })
    );
  };
  vi.stubGlobal('fetch', stable);
  return {
    requests,
    paths: (suffix: string) =>
      requests.filter((request) => new URL(request.url).pathname.endsWith(suffix)),
  };
}

/** يستبدل رد الـ fetch الحالي بدالة async، لاختبارات الرد المتأخر. */
export function replaceFetch(handler: (request: Request) => Promise<Response>) {
  current = handler;
  vi.stubGlobal('fetch', stable);
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** يرندر شاشة جوّا client جديد ولغة محددة، ويرجّع الـ client عشان نفحص الكاش. */
export function renderWork(ui: ReactNode, locale: Locale = 'en') {
  const client = new QueryClient();
  const view = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        {node}
      </LocaleProvider>
    </QueryClientProvider>
  );
  const result = render(view(ui));
  return { client, ...result, rerenderWork: (node: ReactNode) => result.rerender(view(node)) };
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
