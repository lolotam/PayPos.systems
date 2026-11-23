import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { Locale } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { RatingSummaryCard } from './rating-summary-card';
import { fullLine, hiddenRating, hiddenTips, linesPage, visibleRating } from './work-fixtures';
import { installFetch, json, renderWork, type Route } from './work-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const personal: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const reception: WorkContext = { mode: 'reception', identity: '0:sara:device:2026-12-01' };
const label = (key: Parameters<typeof t>[1], locale: Locale = 'en') => t(locale, key);

function serve(rating: Route | undefined) {
  return installFetch((request, url) => {
    if (url.pathname.endsWith('/rating-summary')) return rating?.(request, url);
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view'))
      return json({
        window_id: 'w1',
        window_seq: '1',
        session_ref: 'ref',
        idle_remaining_ms: 60_000,
        cap_remaining_ms: 300_000,
      });
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine]));
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    return undefined;
  });
}
const open = (context: WorkContext, locale: Locale = 'en') =>
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, locale);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('RT-24 shows her average and the number of ratings for the month inside the private view', async () => {
  const fetched = serve(() => json(visibleRating('4.5', 12)));
  const { client } = open(personal);
  expect(await screen.findByText(label('myWork.ratingTitle'))).toBeTruthy();
  expect(screen.getByText('4.5')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  expect(screen.getByText(label('myWork.ratingAverage'))).toBeTruthy();
  expect(screen.getByText(label('myWork.ratingCount'))).toBeTruthy();
  expect(screen.queryByText(label('myWork.ratingNone'))).toBeNull();
  expect(fetched.paths('/rating-summary').length).toBe(1);
  expect(fetched.paths('/rating-summary')[0]?.headers.get('x-private-view-window-id')).toBeNull();
  const key = ['my-work', personal.identity, 'rating-summary'];
  expect(client.getQueryCache().findAll({ queryKey: key })).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});

it('RT-24 says there are no ratings yet for a month without any, and shows no number', async () => {
  serve(() => json(visibleRating(null, 0)));
  open(personal);
  expect(await screen.findByText(label('myWork.ratingNone'))).toBeTruthy();
  expect(screen.getByText(label('myWork.ratingTitle'))).toBeTruthy();
  expect(screen.queryByText(label('myWork.ratingAverage'))).toBeNull();
  expect(screen.queryByText(label('myWork.ratingCount'))).toBeNull();
});

it('RT-24 shows the no-ratings text in Arabic', async () => {
  serve(() => json(visibleRating(null, 0)));
  open(personal, 'ar');
  expect(await screen.findByText(label('myWork.ratingNone', 'ar'))).toBeTruthy();
  expect(screen.getByText(label('myWork.ratingTitle', 'ar'))).toBeTruthy();
});

it('RT-25 shows no card at all when the column is hidden, while her lines still show', async () => {
  const fetched = serve(() => json(hiddenRating()));
  open(personal);
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await vi.waitFor(() => expect(fetched.paths('/rating-summary').length).toBe(1));
  for (const key of ['ratingTitle', 'ratingNone', 'ratingAverage', 'ratingCount'] as const)
    expect(screen.queryByText(label(`myWork.${key}`))).toBeNull();
});

it('RT-25 shows only the title, average and count: no comment, customer, star list or colleague', async () => {
  serve(() =>
    json({
      ...visibleRating('4.5', 2),
      comment: 'Lovely service',
      customer_name: 'Rater One',
      stars: [5, 4],
      employee_id: 'colleague',
    }),
  );
  open(personal);
  const title = await screen.findByText(label('myWork.ratingTitle'));
  const card = title.parentElement?.parentElement;
  expect(card?.textContent).toBe(
    [
      label('myWork.ratingTitle'),
      label('myWork.ratingAverage'),
      '4.5',
      label('myWork.ratingCount'),
      '2',
    ].join(''),
  );
  for (const leaked of ['Lovely service', 'Rater One', 'colleague'])
    expect(screen.queryByText(leaked)).toBeNull();
});

it('shows no card, and keeps her lines, when the rating read fails', async () => {
  serve(() => json({ code: 'NOT_READY' }, 503));
  open(personal);
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(screen.queryByText(label('myWork.ratingTitle'))).toBeNull();
  expect(screen.queryByText(label('myWork.failed'))).toBeNull();
});

it('AC-3-4 the reception device asks no rating summary and shows no rating card', async () => {
  const fetched = serve(() => json(visibleRating('4.5', 12)));
  open(reception);
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(fetched.paths('/rating-summary').length).toBe(0);
  expect(screen.queryByText(label('myWork.ratingTitle'))).toBeNull();
});

it.each([
  ['hidden', hiddenRating()],
  ['not loaded yet', undefined],
] as const)('renders nothing for a summary that is %s', (_, summary) => {
  const { container } = renderWork(<RatingSummaryCard summary={summary} />);
  expect(container.textContent).toBe('');
});
