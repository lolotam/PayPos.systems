import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { cancelledLine, fullLine, hiddenTips, linesPage, visibleTips } from './work-fixtures';
import { installFetch, json, renderWork, replaceFetch } from './work-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const MODES = ['personal', 'reception'] as const;
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const window_ = {
  window_id: 'window-abc',
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: 60_000,
  cap_remaining_ms: 300_000,
};
type Reply = Response | Promise<Response>;
type Handlers = { lines: (url: URL) => Reply; tips: (url: URL) => Reply };

/** السيرفر المزيف: «الشهر الحالي» للإكراميات بدون شهر صريح بيعدّي لشهر 2026-12 بينما الخدمات لسه 2026-11. */
function serve({ lines, tips }: Handlers) {
  installFetch(() => undefined);
  const seen: Request[] = [];
  replaceFetch(async (request) => {
    seen.push(request);
    const url = new URL(request.url);
    const end = (suffix: string) => url.pathname.endsWith(suffix);
    if (end('/private-view/touch'))
      return json({ idle_remaining_ms: 60_000, cap_remaining_ms: 250_000 });
    if (end('/private-view/close')) return new Response(null, { status: 204 });
    if (end('/private-view')) return json(window_);
    if (end('/service-lines')) return lines(url);
    if (end('/tips')) return tips(url);
    return json({ code: 'NOT_FOUND' }, 404);
  });
  const months = (suffix: string) =>
    seen
      .filter((request) => new URL(request.url).pathname.endsWith(suffix))
      .map((request) => new URL(request.url).searchParams.get('month'));
  return { months };
}
const monthLines = (url: URL) => {
  const month = url.searchParams.get('month') ?? '2026-11';
  return json(linesPage([{ ...fullLine, service_name_en: `Service ${month}` }], null, month));
};
const tipsByMonth = (url: URL) => {
  const month = url.searchParams.get('month') ?? '2026-12';
  return json({ ...visibleTips(month), total_cash: month === '2026-11' ? '12.500' : '99.000' });
};

async function open(mode: WorkContext['mode']) {
  const context: WorkContext = { mode, identity: `0:sara:${mode}:2026-12-01` };
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />);
  if (mode === 'personal') return;
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it.each(MODES)(
  'asks for the tips of the month the first lines page returned, never a different current month on %s',
  async (mode) => {
    const fetched = serve({ lines: monthLines, tips: tipsByMonth });
    await open(mode);
    expect(await screen.findByText('Service 2026-11')).toBeTruthy();
    expect(await screen.findByText('12.500')).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.queryByText('99.000')).toBeNull();
    expect(fetched.months('/tips')).toEqual(['2026-11']);
  },
);

it.each(MODES)(
  'shows an error with a retry when the tips read fails, and no tips block when they are hidden on %s',
  async (mode) => {
    let state: 'failing' | 'visible' | 'hidden' = 'failing';
    serve({
      lines: monthLines,
      tips: (url) =>
        state === 'failing'
          ? json({ code: 'NOT_READY' }, 503)
          : state === 'hidden'
            ? json(hiddenTips(url.searchParams.get('month') ?? '2026-11'))
            : tipsByMonth(url),
    });
    await open(mode);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Service 2026-11')).toBeTruthy();
    state = 'visible';
    fireEvent.click(screen.getByText(label('myWork.retry')));
    expect(await screen.findByText('12.500')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(MODES)(
  'shows neither a tips block nor an error when the tips are hidden on %s',
  async (mode) => {
    serve({
      lines: monthLines,
      tips: (url) => json(hiddenTips(url.searchParams.get('month') ?? '')),
    });
    await open(mode);
    expect(await screen.findByText('Service 2026-11')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(label('myWork.loading'))).toBeNull());
    expect(screen.queryByText(label('myWork.tipsTitle'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(MODES)(
  'keeps the loaded lines and shows the error next to a retry when a later page fails on %s',
  async (mode) => {
    let failing = true;
    serve({
      tips: tipsByMonth,
      lines: (url) =>
        url.searchParams.get('cursor') === 'c1'
          ? failing
            ? json({ code: 'NOT_READY' }, 503)
            : json(linesPage([cancelledLine]))
          : json(linesPage([fullLine], 'c1')),
    });
    await open(mode);
    fireEvent.click(await screen.findByText(label('myWork.loadMore')));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Haircut')).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByText(label('myWork.retry')));
    expect(await screen.findByText('Colour')).toBeTruthy();
    expect(screen.getByText('Haircut')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(MODES)(
  'disables previous while the requested month is pending so repeated taps cannot overshoot on %s',
  async (mode) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetched = serve({
      tips: tipsByMonth,
      lines: async (url) => {
        if (url.searchParams.get('month') !== '2026-10') return monthLines(url);
        await gate;
        return json({ code: 'MY_PERIOD_OUT_OF_RANGE' }, 422);
      },
    });
    await open(mode);
    expect(await screen.findByText('Service 2026-11')).toBeTruthy();
    const previous = screen.getByText(label('myWork.previousMonth')) as HTMLButtonElement;
    fireEvent.click(previous);
    fireEvent.click(previous);
    fireEvent.click(previous);
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(previous.disabled).toBe(true);
    expect(fetched.months('/service-lines')).toEqual([null, '2026-10']);
    release();
    expect(await screen.findByText(label('myWork.outOfRange'))).toBeTruthy();
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(previous.disabled).toBe(true);
    expect((screen.getByText(label('myWork.nextMonth')) as HTMLButtonElement).disabled).toBe(false);
  },
);
