import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { WorkContext } from '../model/work-context';
import { MyWorkScreen } from './my-work-screen';
import { cancelledLine, fullLine, hiddenTips, linesPage } from './work-fixtures';
import { installFetch, json, myWorkEntries, renderWork } from './work-test-kit';

const context: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);

/** الصفحة الأولى بتنجح ومعاها مؤشر، والصفحة التانية بترد بالحالة المطلوبة. */
function serveSecondPage(status: number, code: string) {
  return installFetch((_, url) => {
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    if (!url.pathname.endsWith('/service-lines')) return undefined;
    return url.searchParams.get('cursor') === 'c1'
      ? json({ code }, status)
      : json(linesPage([fullLine], 'c1'));
  });
}
const open = (onLeave: () => void = () => undefined) =>
  renderWork(<MyWorkScreen context={context} onLeave={onLeave} />);
const loadMore = async () => fireEvent.click(await screen.findByText(label('myWork.loadMore')));
const cachedLines = (client: ReturnType<typeof open>['client']) =>
  myWorkEntries(client).filter((query) => query.queryKey.includes('lines'));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('hides the loaded rows, shows the refused state and clears them from the cache when a later page is refused with 403', async () => {
  serveSecondPage(403, 'FORBIDDEN');
  const view = open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await loadMore();
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(screen.queryByText(label('myWork.loadMore'))).toBeNull();
  expect(screen.queryByText(label('myWork.retry'))).toBeNull();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  await waitFor(() =>
    expect(cachedLines(view.client).every((q) => q.state.data === undefined)).toBe(true),
  );
});

it('keeps the loaded rows and offers a retry when a later page fails with a server error', async () => {
  serveSecondPage(500, 'INTERNAL');
  const view = open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await loadMore();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(screen.getByText(label('myWork.retry'))).toBeTruthy();
  expect(screen.queryByText(label('myWork.refused'))).toBeNull();
  expect(cachedLines(view.client).some((q) => q.state.data !== undefined)).toBe(true);
});

it('leaves the private screen and clears her data when a later page ends the session with 401', async () => {
  const mounted: { unmount?: () => void } = {};
  const onLeave = vi.fn(() => mounted.unmount?.());
  serveSecondPage(401, 'UNAUTHENTICATED');
  const view = open(onLeave);
  mounted.unmount = view.unmount;
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await loadMore();
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(myWorkEntries(view.client).length).toBe(0);
});

it('lets her step to another month after a refused later page and reads that month normally', async () => {
  installFetch((_, url) => {
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    if (!url.pathname.endsWith('/service-lines')) return undefined;
    if (url.searchParams.get('cursor') === 'c1') return json({ code: 'FORBIDDEN' }, 403);
    return url.searchParams.get('month') === '2026-10'
      ? json(linesPage([cancelledLine], null, '2026-10'))
      : json(linesPage([fullLine], 'c1', '2026-11'));
  });
  open();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await loadMore();
  expect(await screen.findByText(label('myWork.refused'))).toBeTruthy();
  expect(screen.getByText('November 2026')).toBeTruthy();
  fireEvent.click(screen.getByText(label('myWork.previousMonth')));
  expect(await screen.findByText('Colour')).toBeTruthy();
  expect(screen.queryByText(label('myWork.refused'))).toBeNull();
});
