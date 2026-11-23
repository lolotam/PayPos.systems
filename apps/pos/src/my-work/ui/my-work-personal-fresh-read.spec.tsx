import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { fullLine, linesPage, visibleRating, visibleTips } from './work-fixtures';
import { installFetch, json, renderWork, replaceFetch } from './work-test-kit';

const context: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
type Reply = Response | Promise<Response>;

/** الكاش بيحتفظ بقراءات «زيارة سابقة» بنفس المفاتيح: خدمة، إكرامية، وتقييم باسماء ومبالغ نقدر نتعرف عليها. */
function earlierVisit() {
  const client = new QueryClient();
  const seed = (suffix: unknown[], data: unknown) =>
    client.setQueryData(['my-work', context.identity, ...suffix], data);
  seed(['lines', 'current'], {
    pages: [linesPage([{ ...fullLine, service_name_en: 'Seeded service' }], null, '2026-11')],
    pageParams: [undefined],
  });
  seed(['tips', '2026-11'], {
    ...visibleTips('2026-11'),
    total_cash: '11.111',
    total_card: '22.222',
  });
  seed(['rating-summary'], visibleRating('2.25', 77));
  return client;
}
const SEEDED = ['Seeded service', '11.111', '22.222', '2.25', '77'];

/** يسجّل لو أي نص من النصوص دي ظهر ولو لحظة، لأن الظهور المؤقت قبل رد السيرفر هو العيب نفسه. */
let stopWatching: () => void = () => undefined;
function watchFor(texts: string[]) {
  const seen = new Set<string>();
  const scan = () => {
    for (const text of texts) if (document.body.textContent?.includes(text)) seen.add(text);
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  stopWatching = () => observer.disconnect();
  scan();
  return seen;
}

/** سيرفر مزيف: كل قراءة بتتحكم فيها دالة، فنقدر نسيب الرد معلّق أو نرفضه. */
function serve(reads: { lines: () => Reply; tips: () => Reply; rating: () => Reply }) {
  installFetch(() => undefined);
  replaceFetch(async (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/service-lines')) return reads.lines();
    if (path.endsWith('/tips')) return reads.tips();
    if (path.endsWith('/rating-summary')) return reads.rating();
    return json({ code: 'NOT_FOUND' }, 404);
  });
}
function held() {
  let release: (response: Response) => void = () => undefined;
  const reply = new Promise<Response>((resolve) => (release = resolve));
  return { reply: () => reply, release };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  stopWatching();
  vi.unstubAllGlobals();
});

it('shows nothing from an earlier visit while the server has not yet answered this one, then the fresh values', async () => {
  const lines = held();
  const tips = held();
  const rating = held();
  serve({ lines: lines.reply, tips: tips.reply, rating: rating.reply });
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, 'en', earlierVisit());
  const seen = watchFor(SEEDED);
  expect(screen.getByText(label('myWork.loading'))).toBeTruthy();
  for (const text of SEEDED) expect(screen.queryByText(text)).toBeNull();
  lines.release(
    json(linesPage([{ ...fullLine, service_name_en: 'Fresh service' }], null, '2026-11')),
  );
  expect(await screen.findByText('Fresh service')).toBeTruthy();
  for (const text of SEEDED) expect(screen.queryByText(text)).toBeNull();
  tips.release(json({ ...visibleTips('2026-11'), total_cash: '33.333', total_card: '44.444' }));
  rating.release(json(visibleRating('4.75', 88)));
  expect(await screen.findByText('33.333')).toBeTruthy();
  expect(await screen.findByText('4.75')).toBeTruthy();
  expect(screen.getByText('88')).toBeTruthy();
  expect([...seen]).toEqual([]);
});

it('never shows the rows of an earlier visit when this visit is refused with 403, only the refused state', async () => {
  const rating = held();
  serve({
    lines: () => json({ code: 'FORBIDDEN' }, 403),
    tips: () => json({ code: 'FORBIDDEN' }, 403),
    rating: rating.reply,
  });
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, 'en', earlierVisit());
  const seen = watchFor(SEEDED);
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(label('myWork.loading'))).toBeNull());
  for (const text of SEEDED) expect(screen.queryByText(text)).toBeNull();
  expect([...seen]).toEqual([]);
});

it('shows neither the earlier tips nor the earlier rating when this visit reads them with a server error', async () => {
  serve({
    lines: () =>
      json(linesPage([{ ...fullLine, service_name_en: 'Fresh service' }], null, '2026-11')),
    tips: () => json({ code: 'NOT_READY' }, 503),
    rating: () => json({ code: 'NOT_READY' }, 503),
  });
  renderWork(<MyWorkScreen context={context} onLeave={() => undefined} />, 'en', earlierVisit());
  const seen = watchFor(SEEDED);
  expect(await screen.findByText('Fresh service')).toBeTruthy();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(label('myWork.ratingTitle'))).toBeNull();
  for (const text of SEEDED) expect(screen.queryByText(text)).toBeNull();
  expect([...seen]).toEqual([]);
});
