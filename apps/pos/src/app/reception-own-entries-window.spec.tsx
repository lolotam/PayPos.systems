import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { fullLine, hiddenTips, linesPage } from '@/my-work/ui/work-fixtures';
import {
  installFetch,
  json,
  myWorkEntries,
  renderWork,
  typeInMyWork,
} from '@/my-work/ui/work-test-kit';
import { ReceptionOwnEntries } from './reception-own-entries';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const session = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  branch_id: id(5),
  device_id: id(6),
  expires_at: '2026-12-01T10:00:00.000Z',
};
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const remaining = (idle: number, cap: number) => ({
  idle_remaining_ms: idle,
  cap_remaining_ms: cap,
});
const opened = (idle: number, cap: number) => ({
  window_id: 'window-abc',
  window_seq: '1',
  session_ref: 'ref',
  ...remaining(idle, cap),
});

type Touch = (elapsed: number) => Response;

/** سيرفر نافذة العرض الخاص؛ `elapsed` الوقت من فتح النافذة بالساعة الرتيبة اللي الاختبار بيتحكم فيها. */
function serve(open: ReturnType<typeof opened>, touch: Touch) {
  let openedAt = 0;
  const elapsed = () => performance.now() - openedAt;
  return installFetch((_, url) => {
    if (url.pathname.endsWith('/private-view/touch')) return touch(elapsed());
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) {
      openedAt = performance.now();
      return json(open);
    }
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine]));
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    return undefined;
  });
}

const mountEntries = () =>
  renderWork(
    <ReceptionOwnEntries
      session={session}
      epoch={0}
      branchId={id(5)}
      deviceId={id(6)}
      zone={null}
    />,
  );
const signIn = async () => {
  fireEvent.click(screen.getByRole('button', { name: label('myWork.title') }));
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const typeEvery = async (stepMs: number, steps: number) => {
  for (let step = 0; step < steps; step += 1) {
    await advance(stepMs);
    typeInMyWork('a');
  }
};
const closedToPin = async () => {
  expect(await screen.findByText(label('myWork.pinTitle'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('closes at the short cap the server gave even while she keeps typing and every touch succeeds', async () => {
  const fetched = serve(opened(60_000, 30_000), (elapsed) =>
    json(remaining(60_000, Math.max(0, 30_000 - elapsed))),
  );
  const view = mountEntries();
  await signIn();
  await typeEvery(5_000, 5);
  expect(screen.getByText('Haircut')).toBeTruthy();
  await typeEvery(5_000, 2);
  await closedToPin();
  expect(myWorkEntries(view.client).length).toBe(0);
  await waitFor(() => expect(fetched.paths('/private-view/close').length).toBe(1));
});

it.each([
  [
    'a network failure',
    (): Response => {
      throw new TypeError('offline');
    },
  ],
  ['a server error', (): Response => json({ code: 'NOT_READY' }, 503)],
])('closes at the last confirmed deadline when every touch fails with %s', async (_, failure) => {
  const fetched = installFetch((_request, url) => {
    if (url.pathname.endsWith('/private-view/touch')) return failure();
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(opened(60_000, 300_000));
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine]));
    return json(hiddenTips());
  });
  const view = mountEntries();
  await signIn();
  await typeEvery(5_000, 11);
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(fetched.paths('/private-view/touch').length).toBeGreaterThan(0);
  await typeEvery(2_000, 3);
  await closedToPin();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('moves the close time only to what a successful touch answered, never by her typing alone', async () => {
  serve(opened(60_000, 300_000), () => json(remaining(40_000, 250_000)));
  mountEntries();
  await signIn();
  await advance(50_000);
  typeInMyWork('a');
  await advance(38_000);
  expect(screen.getByText('Haircut')).toBeTruthy();
  await advance(3_000);
  await closedToPin();
});

it('returns to the PIN step at once when a touch says the window expired and leaves when it says the session ended', async () => {
  serve(opened(60_000, 300_000), () => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403));
  const view = mountEntries();
  await signIn();
  await advance(21_000);
  typeInMyWork('a');
  await closedToPin();
  expect(screen.getByText(t('en', 'errors.PRIVATE_VIEW_EXPIRED'))).toBeTruthy();
  expect(myWorkEntries(view.client).length).toBe(0);
  view.unmount();
  serve(opened(60_000, 300_000), () => json({ code: 'UNAUTHENTICATED' }, 401));
  mountEntries();
  await signIn();
  await advance(21_000);
  typeInMyWork('a');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: label('myWork.title') }).getAttribute('aria-expanded'),
    ).toBe('false'),
  );
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('leaves nothing cached after the close and asks for the PIN and refetches when she opens it again', async () => {
  const fetched = serve(opened(60_000, 20_000), () => json(remaining(60_000, 1)));
  const view = mountEntries();
  await signIn();
  expect(fetched.paths('/service-lines').length).toBe(1);
  await advance(21_000);
  await closedToPin();
  expect(myWorkEntries(view.client).length).toBe(0);
  fireEvent.change(screen.getByLabelText(label('myWork.pinLabel')), { target: { value: '4321' } });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  expect(fetched.paths('/service-lines').length).toBe(2);
});
