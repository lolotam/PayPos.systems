import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import {
  cancelledLine,
  fullLine,
  hiddenTips,
  linesPage,
  netOnlyLine,
  visibleTips,
} from './work-fixtures';
import { installFetch, json, myWorkEntries, renderWork } from './work-test-kit';

const context: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
type Handlers = {
  lines?: (url: URL) => Response;
  tips?: (url: URL) => Response;
};

function serve({ lines, tips }: Handlers = {}) {
  return installFetch((_, url) => {
    if (url.pathname.endsWith('/service-lines'))
      return (lines ?? (() => json(linesPage([fullLine, cancelledLine]))))(url);
    if (url.pathname.endsWith('/tips')) return (tips ?? (() => json(hiddenTips())))(url);
    return undefined;
  });
}
const open = (props: { onLeave?: () => void } = {}) =>
  renderWork(<MyWorkScreen context={context} onLeave={props.onLeave ?? (() => undefined)} />);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('shows this month lines with every allowed column and no PIN step on her own phone', async () => {
  const fetched = serve();
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  for (const key of [
    'date',
    'time',
    'service',
    'customer',
    'listPrice',
    'discount',
    'net',
    'share',
  ] as const)
    expect(screen.getAllByText(label(`myWork.${key}`)).length).toBe(2);
  expect(screen.getAllByText('Main branch').length).toBe(2);
  expect(screen.getAllByText('50%').length).toBe(2);
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  expect(fetched.paths('/private-view').length).toBe(0);
  expect(fetched.paths('/service-lines')[0]?.headers.get('x-private-view-window-id')).toBeNull();
  expect(screen.getByText('November 2026')).toBeTruthy();
  expect(localStorage.length).toBe(0);
});

it('shows only the columns that came back, with no empty header or dash for the hidden ones', async () => {
  serve({ lines: () => json(linesPage([netOnlyLine])) });
  open();
  expect(await screen.findByText('4.500')).toBeTruthy();
  expect(screen.getByText(label('myWork.net'))).toBeTruthy();
  for (const key of [
    'date',
    'time',
    'service',
    'customer',
    'listPrice',
    'discount',
    'share',
  ] as const)
    expect(screen.queryByText(label(`myWork.${key}`))).toBeNull();
  expect(screen.queryByText('-')).toBeNull();
  expect(screen.queryByText('—')).toBeNull();
});

it('strikes a cancelled line through and shows the cancelled mark with its date', async () => {
  serve();
  open();
  expect(await screen.findByText('Colour')).toBeTruthy();
  const cancelled = screen.getByText('Colour').closest('dl');
  expect(cancelled?.className).toContain('line-through');
  expect(screen.getByText(label('myWork.cancelled'))).toBeTruthy();
  expect(screen.getByText(/Cancelled on\s+November 21, 2026/)).toBeTruthy();
  expect(screen.getByText('Haircut').closest('dl')?.className).not.toContain('line-through');
});

it('shows the late mark next to a late entry', async () => {
  serve({ lines: () => json(linesPage([{ ...fullLine, late: true }])) });
  open();
  expect(await screen.findByText(label('myWork.late'))).toBeTruthy();
});

it('shows her own tips by method when tips are allowed and no tips block when hidden', async () => {
  serve({ tips: () => json(visibleTips()) });
  const first = open();
  expect(await screen.findByText(label('myWork.tipsTitle'))).toBeTruthy();
  expect(screen.getByText('12.500')).toBeTruthy();
  expect(screen.getByText('7.250')).toBeTruthy();
  first.unmount();
  serve();
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(screen.queryByText(label('myWork.tipsTitle'))).toBeNull();
});

it('shows no estimate card when the estimate read is not available for her', async () => {
  serve();
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
});

it('shows loading first and then the empty state when the month has no lines', async () => {
  serve({ lines: () => json(linesPage([])) });
  open();
  expect(screen.getByText(label('myWork.loading'))).toBeTruthy();
  expect(await screen.findByText(label('myWork.empty'))).toBeTruthy();
});

it('shows the empty state in Arabic with a right-to-left section', async () => {
  serve({ lines: () => json(linesPage([])) });
  const view = renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, 'ar');
  expect(await screen.findByText(t('ar', 'myWork.empty'))).toBeTruthy();
  expect(view.container.querySelector('section')?.getAttribute('dir')).toBe('rtl');
});

it('shows the Arabic service and branch names in the Arabic locale', async () => {
  serve({ lines: () => json(linesPage([fullLine])) });
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, 'ar');
  expect(await screen.findByText('Haircut AR')).toBeTruthy();
  expect(screen.getByText('Main branch AR')).toBeTruthy();
  expect(screen.getByText(t('ar', 'myWork.share'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('shows an error with a retry that loads the lines', async () => {
  let failing = true;
  serve({
    lines: () => (failing ? json({ code: 'NOT_READY' }, 503) : json(linesPage([fullLine]))),
  });
  open();
  expect(await screen.findByText(label('myWork.failed'))).toBeTruthy();
  failing = false;
  fireEvent.click(screen.getByText(label('myWork.retry')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
});

it('loads the next page by cursor and then hides the load-more button', async () => {
  const fetched = serve({
    lines: (url) =>
      url.searchParams.get('cursor') === 'next-1'
        ? json(linesPage([cancelledLine]))
        : json(linesPage([fullLine], 'next-1')),
  });
  open();
  fireEvent.click(await screen.findByText(label('myWork.loadMore')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(screen.queryByText(label('myWork.loadMore'))).toBeNull();
  expect(new URL(fetched.paths('/service-lines')[1]?.url ?? '').searchParams.get('cursor')).toBe(
    'next-1',
  );
});

it('requests the next page with the month the first page returned, not the implicit current month', async () => {
  const fetched = serve({
    lines: (url) =>
      url.searchParams.get('cursor') === 'next-1'
        ? json(linesPage([cancelledLine], null, '2026-11'))
        : json(linesPage([fullLine], 'next-1', '2026-11')),
  });
  open();
  fireEvent.click(await screen.findByText(label('myWork.loadMore')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  const [first, second] = fetched.paths('/service-lines').map((r) => new URL(r.url).searchParams);
  expect(first?.get('month')).toBeNull();
  expect(second?.get('cursor')).toBe('next-1');
  expect(second?.get('month')).toBe('2026-11');
});

it('shows a labelled UTC time instead of crashing the list when the business zone is unknown to this device', async () => {
  serve({
    lines: () => json(linesPage([fullLine, cancelledLine], null, '2026-11', 'Not/A_Zone')),
  });
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(screen.getAllByText('10:30 UTC').length).toBe(2);
  expect(screen.getByText(/Cancelled on\s+November 21, 2026 at 09:00 UTC/)).toBeTruthy();
});

it('steps back a month with the server month as the start and never past the current month', async () => {
  const fetched = serve({
    lines: (url) => {
      const month = url.searchParams.get('month') ?? '2026-11';
      return json(linesPage([{ ...fullLine, service_name_en: `Service ${month}` }], null, month));
    },
  });
  open();
  expect(await screen.findByText('Service 2026-11')).toBeTruthy();
  const next = screen.getByText(label('myWork.nextMonth')) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  expect(await screen.findByText('Service 2026-10')).toBeTruthy();
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(new URL(fetched.paths('/service-lines').at(-1)?.url ?? '').searchParams.get('month')).toBe(
    '2026-10',
  );
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  expect(await screen.findByText('Service 2026-11')).toBeTruthy();
  expect(next.disabled).toBe(true);
});

it('stops at the months-back limit: shows the notice and disables the previous month', async () => {
  serve({
    lines: (url) =>
      url.searchParams.get('month') === '2026-09'
        ? json({ code: 'MY_PERIOD_OUT_OF_RANGE' }, 422)
        : json(linesPage([fullLine], null, url.searchParams.get('month') ?? '2026-10')),
    tips: () => json(hiddenTips()),
  });
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  expect(await screen.findByText(label('myWork.outOfRange'))).toBeTruthy();
  expect((screen.getByText(label('myWork.previousMonth')) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByText(label('myWork.nextMonth')) as HTMLButtonElement).disabled).toBe(false);
});

it('shows a refused state for a forbidden page without asking for a PIN', async () => {
  serve({ lines: () => json({ code: 'FORBIDDEN' }, 403) });
  open();
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
});

it('leaves the private screen and clears its cache when the session ends with a 401', async () => {
  const onLeave = vi.fn();
  serve({ lines: () => json({ code: 'UNAUTHENTICATED' }, 401) });
  const view = open({ onLeave });
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('removes her data from the cache when the screen is left', async () => {
  serve();
  const view = open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(myWorkEntries(view.client).length).toBeGreaterThan(0);
  view.unmount();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('does not refetch on its own and asks for the internet when offline', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetched = serve();
  const view = open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  const before = fetched.requests.length;
  await vi.advanceTimersByTimeAsync(180_000);
  expect(fetched.requests.length).toBe(before);
  vi.useRealTimers();
  view.unmount();
  const offline = installFetch(() => undefined);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  open();
  expect(screen.getByText(label('myWork.offline'))).toBeTruthy();
  expect(offline.requests.length).toBe(0);
});

it('AC-57-4-9 shows the line time and the cancellation date in the response business zone on her phone', async () => {
  const late = { ...fullLine, time: '2026-11-14T21:30:00Z' };
  const cancelled = { ...cancelledLine, time: '2026-11-14T22:00:00Z', cancelled_at: late.time };
  serve({ lines: () => json(linesPage([late, cancelled], null, '2026-11', 'Asia/Kuwait')) });
  open();
  expect(await screen.findByText('00:30')).toBeTruthy();
  expect(screen.getByText('01:00')).toBeTruthy();
  expect(screen.queryByText('21:30')).toBeNull();
  expect(screen.getByText(/Cancelled on\s+November 15, 2026/)).toBeTruthy();
});

it('AC-57-4-9 follows a different business zone from the response rather than a fixed one', async () => {
  const line = { ...fullLine, time: '2026-11-14T21:30:00Z' };
  serve({ lines: () => json(linesPage([line], null, '2026-11', 'America/New_York')) });
  open();
  expect(await screen.findByText('16:30')).toBeTruthy();
});
