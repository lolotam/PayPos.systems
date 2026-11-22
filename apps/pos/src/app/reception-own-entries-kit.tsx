import { act, fireEvent, screen } from '@testing-library/react';
import { expect } from 'vitest';
import { t } from '@pospay/i18n';
import { fullLine, hiddenTips, linesPage } from '@/my-work/ui/work-fixtures';
import { installFetch, json, replaceFetch, renderWork } from '@/my-work/ui/work-test-kit';
import { ReceptionOwnEntries } from './reception-own-entries';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
export const session = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  branch_id: id(5),
  device_id: id(6),
  expires_at: '2026-12-01T10:00:00.000Z',
};
export const label = (key: Parameters<typeof t>[1]) => t('en', key);
export const opened = (windowId = 'window-abc', idle = 60_000, cap = 300_000) => ({
  window_id: windowId,
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});

type Answer = Response | Promise<Response>;
type Handler = (request: Request, url: URL) => Answer;
export type Handlers = {
  open?: Handler;
  touch?: Handler;
  lines?: Handler;
  tips?: Handler;
};

/** سيرفر مزيف لنافذة العرض الخاص؛ كل معالج ممكن يرجّع Promise لتأجيل الرد. */
export function serve(handlers: Handlers = {}) {
  const requests: Request[] = [];
  installFetch(() => undefined);
  replaceFetch(async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith('/private-view/touch'))
      return (
        handlers.touch ?? (() => json({ idle_remaining_ms: 60_000, cap_remaining_ms: 250_000 }))
      )(request, url);
    if (path.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (path.endsWith('/private-view'))
      return (handlers.open ?? (() => json(opened())))(request, url);
    if (path.endsWith('/service-lines'))
      return (handlers.lines ?? (() => json(linesPage([fullLine]))))(request, url);
    if (path.endsWith('/tips')) return (handlers.tips ?? (() => json(hiddenTips())))(request, url);
    return json({ code: 'NOT_FOUND' }, 404);
  });
  const paths = (suffix: string) =>
    requests.filter((r) => new URL(r.url).pathname.endsWith(suffix));
  return { requests, paths, closes: () => paths('/private-view/close') };
}

/** بوابة بتأجّل رد لحد ما الاختبار يفتحها. */
export function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

export const mountEntries = () =>
  renderWork(
    <ReceptionOwnEntries
      session={session}
      epoch={0}
      branchId={id(5)}
      deviceId={id(6)}
      zone={null}
    />,
  );

export const openScreen = () =>
  fireEvent.click(screen.getByRole('button', { name: label('myWork.title') }));
export const submitPin = async () => {
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
};
export const signIn = async () => {
  openScreen();
  await submitPin();
  expect(await screen.findByText('Haircut')).toBeTruthy();
};

/** الخروجات من الواجهة اللي لازم تقفل النافذة، وكل واحد بيتبعت زي ما المتصفح بيبعته. */
export const EXITS: Record<string, () => void> = {
  'tab hidden': () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  },
  pagehide: () => window.dispatchEvent(new Event('pagehide')),
  freeze: () => document.dispatchEvent(new Event('freeze')),
  resume: () => document.dispatchEvent(new Event('resume')),
  'window blur': () => window.dispatchEvent(new Event('blur')),
  'persisted pageshow': () =>
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })),
};
export const exit = (name: string) => act(() => EXITS[name]?.());
export const restoreVisibility = () => Reflect.deleteProperty(document, 'visibilityState');
