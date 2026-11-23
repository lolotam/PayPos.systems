import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import {
  fullLine,
  hiddenRating,
  hiddenTips,
  linesPage,
  visibleRating,
  visibleTips,
} from './work-fixtures';
import { installFetch, json, renderWork, replaceFetch } from './work-test-kit';

const context: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const row = (name: string) => ({ ...fullLine, service_name_en: name });
type Reply = Response | Promise<Response>;

/** سيرفر مزيف: الخدمات بتتحكم فيها دالة بالـ URL، والإكراميات والتقييم دوال نقدر نبدّل ردها. */
function serve(
  lines: (url: URL) => Reply,
  other: { tips?: () => Reply; rating?: () => Reply } = {},
) {
  installFetch(() => undefined);
  replaceFetch(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/service-lines')) return lines(url);
    if (url.pathname.endsWith('/tips')) return other.tips?.() ?? json(hiddenTips());
    if (url.pathname.endsWith('/rating-summary')) return other.rating?.() ?? json(hiddenRating());
    return json({ code: 'NOT_FOUND' }, 404);
  });
}
function held() {
  let release: (response: Response) => void = () => undefined;
  const reply = new Promise<Response>((resolve) => (release = resolve));
  return { reply: () => reply, release };
}
const openScreen = () => <MyWorkScreen context={context} onLeave={() => undefined} />;

/** يسجّل لو أي نص من دول ظهر ولو لحظة جوّا العنصر، لأن الظهور المؤقت قبل القراءة هو العيب نفسه. */
let stopWatching: () => void = () => undefined;
function watchFor(root: HTMLElement, texts: string[]) {
  const seen = new Set<string>();
  const scan = () => {
    for (const text of texts) if (root.textContent?.includes(text)) seen.add(text);
  };
  const observer = new MutationObserver(scan);
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  stopWatching = () => observer.disconnect();
  scan();
  return seen;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  stopWatching();
  vi.unstubAllGlobals();
});

it('never shows a second screen the rows another open screen loaded, even while that one appends its next page', async () => {
  const appendOnFirst = held();
  const firstPageOfSecond = held();
  const reads = { firstPages: 0, appends: 0 };
  serve((url) => {
    if (url.searchParams.get('cursor') === 'c1') {
      reads.appends += 1;
      return appendOnFirst.reply();
    }
    reads.firstPages += 1;
    return reads.firstPages === 1
      ? json(linesPage([row('First screen row')], 'c1'))
      : firstPageOfSecond.reply();
  });
  const first = renderWork(openScreen());
  const inFirst = within(first.container);
  expect(await inFirst.findByText('First screen row')).toBeTruthy();
  fireEvent.click(inFirst.getByText(label('myWork.loadMore')));
  await waitFor(() => expect(reads.appends).toBe(1));

  const second = renderWork(openScreen(), 'en', first.client);
  const inSecond = within(second.container);
  const seen = watchFor(second.container, ['First screen row', 'Page two row']);
  expect(inSecond.getByText(label('myWork.loading'))).toBeTruthy();
  await waitFor(() => expect(reads.firstPages).toBe(2));

  appendOnFirst.release(json(linesPage([row('Page two row')], null)));
  expect(await inFirst.findByText('Page two row')).toBeTruthy();
  expect(inSecond.getByText(label('myWork.loading'))).toBeTruthy();
  expect([...seen]).toEqual([]);

  firstPageOfSecond.release(json(linesPage([row('Second screen row')], null)));
  expect(await inSecond.findByText('Second screen row')).toBeTruthy();
  expect(inSecond.queryByText('First screen row')).toBeNull();
  expect(inSecond.queryByText('Page two row')).toBeNull();
  expect([...seen]).toEqual([]);
});

it('hides her rating at once when a later read of it is refused with 403, leaving no stale average', async () => {
  let refused = false;
  serve(() => json(linesPage([fullLine])), {
    rating: () => (refused ? json({ code: 'FORBIDDEN' }, 403) : json(visibleRating('4.5', 12))),
  });
  const view = renderWork(openScreen());
  expect(await screen.findByText('4.5')).toBeTruthy();
  refused = true;
  await act(() =>
    view.client.refetchQueries({ predicate: (q) => q.queryKey.includes('rating-summary') }),
  );
  await waitFor(() => expect(screen.queryByText(label('myWork.ratingTitle'))).toBeNull());
  expect(screen.queryByText('4.5')).toBeNull();
  expect(screen.queryByText('12')).toBeNull();
  expect(screen.getByText('Haircut')).toBeTruthy();
});

it('hides her tips and offers a retry when a later read of them is refused with 403', async () => {
  let refused = false;
  serve(() => json(linesPage([fullLine])), {
    tips: () => (refused ? json({ code: 'FORBIDDEN' }, 403) : json(visibleTips())),
  });
  const view = renderWork(openScreen());
  expect(await screen.findByText('12.500')).toBeTruthy();
  refused = true;
  await act(() => view.client.refetchQueries({ predicate: (q) => q.queryKey.includes('tips') }));
  await waitFor(() => expect(screen.queryByText('12.500')).toBeNull());
  expect(screen.queryByText('7.250')).toBeNull();
  expect(await screen.findByRole('alert')).toBeTruthy();
});

it('does not show a month again after leaving it and coming straight back until it is read again in this visit', async () => {
  const otherMonth = held();
  const returned = held();
  const reads = { current: 0 };
  serve((url) => {
    if (url.searchParams.get('month') === '2026-10') return otherMonth.reply();
    reads.current += 1;
    return reads.current === 1
      ? json(linesPage([row('November row')], null, '2026-11'))
      : returned.reply();
  });
  renderWork(openScreen());
  expect(await screen.findByText('November row')).toBeTruthy();
  const seen = watchFor(document.body, ['November row']);
  seen.clear();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  fireEvent.click(screen.getByText(label('myWork.nextMonth')));
  expect(screen.getByText(label('myWork.loading'))).toBeTruthy();
  expect(screen.queryByText('November row')).toBeNull();
  await waitFor(() => expect(reads.current).toBe(2));
  expect([...seen]).toEqual([]);
  returned.release(json(linesPage([row('November row again')], null, '2026-11')));
  expect(await screen.findByText('November row again')).toBeTruthy();
});
