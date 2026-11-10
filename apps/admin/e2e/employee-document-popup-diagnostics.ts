import type { BrowserContext, Frame, Page, Request, Response } from '@playwright/test';

const UNAVAILABLE = 'unavailable' as const;
type Route = 'download' | 'documents' | 'other';
function category(url: string): Route {
  try {
    const path = new URL(url).pathname;
    if (path === '/v1/files/download') return 'download';
    return path.endsWith('/documents') ? 'documents' : 'other';
  } catch {
    return 'other';
  }
}

// الرصد اختياري؛ رفضه أو تعليقه لا يحل محل فشل تأكيد المتصفح الأصلي.
async function bounded<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => UNAVAILABLE),
      new Promise<typeof UNAVAILABLE>((resolve) => {
        timer = setTimeout(() => resolve(UNAVAILABLE), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function observeNative() {
  const count = (name: string) => {
    const data = document.documentElement?.dataset;
    if (data) data[name] = String(Number(data[name] ?? 0) + 1);
  };
  window.addEventListener('focus', () => count('popupDiagFocus'), { passive: true });
  document.addEventListener('visibilitychange', () => count('popupDiagVisibility'), {
    passive: true,
  });
  document.addEventListener('DOMContentLoaded', () => count('popupDiagReady'), { once: true });
}
async function snapshot(frame: Frame) {
  return frame
    .evaluate(() => ({
      visible: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
      focused: document.hasFocus(),
      workspace: document.querySelectorAll('#workspace-company').length,
      observed: document.documentElement?.dataset['popupDiagReady'] !== undefined,
      focus: Number(document.documentElement?.dataset['popupDiagFocus'] ?? 0),
      changes: Number(document.documentElement?.dataset['popupDiagVisibility'] ?? 0),
    }))
    .catch(() => UNAVAILABLE);
}

export async function installPopupDiagnostics(context: BrowserContext) {
  const events: Array<[string, Route, number]> = [];
  const counts: Record<string, number> = {};
  const pages = context.pages().slice(0, 8);
  let overflow = context.pages().length - pages.length;
  const record = (event: string, route: Route = 'other', status = 0) => {
    const key = `${event}:${route}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (events.length === 16) {
      events.shift();
      overflow += 1;
    }
    events.push([event, route, status]);
  };
  const created = (page: Page) => {
    if (pages.length < 8) pages.push(page);
    else overflow += 1;
    record('created');
  };
  const start = (request: Request) => record('start', category(request.url()));
  const finish = (request: Request) => record('finish', category(request.url()));
  const failed = (request: Request) => record('failed', category(request.url()));
  const response = (value: Response) => record('response', category(value.url()), value.status());
  const pageError = () => record('pageerror');
  context.on('page', created).on('weberror', pageError).on('request', start);
  context.on('requestfinished', finish).on('requestfailed', failed).on('response', response);
  if ((await bounded(context.addInitScript(observeNative))) === UNAVAILABLE) record(UNAVAILABLE);
  return async (didFail: boolean) => {
    try {
      if (!didFail) return;
      const frames = pages.flatMap((page) => {
        if (page.isClosed()) return [];
        const all = page.frames();
        overflow += Math.max(0, all.length - 4);
        return all.slice(0, 4);
      });
      const detail = await bounded(Promise.all(frames.map(snapshot)));
      console.log(
        'admin-popup-diagnostic',
        JSON.stringify({
          events,
          counts,
          overflow,
          closed: pages.map((page) => page.isClosed()),
          detail,
        }),
      );
    } catch {
      console.log('admin-popup-diagnostic', UNAVAILABLE);
    } finally {
      context.off('page', created).off('weberror', pageError).off('request', start);
      context.off('requestfinished', finish).off('requestfailed', failed).off('response', response);
    }
  };
}
