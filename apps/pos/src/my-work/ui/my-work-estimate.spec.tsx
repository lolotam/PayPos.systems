import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import type { OwnCommissionEstimate } from '@pospay/contracts';
import type { WorkContext } from '../model/work-context';
import { formatBusinessDate } from '../model/work-format';
import { MyWorkScreen } from './my-work-screen';
import {
  approvedEstimate,
  cancelledLine,
  fullLine,
  hiddenEstimate,
  hiddenTips,
  lineCorrection,
  linesPage,
  noPlanEstimate,
  noSalaryEstimate,
  openEstimate,
  saleCorrection,
} from './work-fixtures';
import { installFetch, json, renderWork, type Route } from './work-test-kit';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const personal: WorkContext = { mode: 'personal', identity: '0:user:employee:2026-12-01' };
const reception: WorkContext = { mode: 'reception', identity: '0:sara:device:2026-12-01' };
const label = (key: Parameters<typeof t>[1]) => t('en', key);
const window_ = {
  window_id: 'window-abc',
  window_seq: '1',
  session_ref: 'ref',
  idle_remaining_ms: 60_000,
  cap_remaining_ms: 300_000,
};

function serve(estimate: Route | OwnCommissionEstimate) {
  return installFetch((request, url) => {
    if (url.pathname.endsWith('/commission-estimate'))
      return typeof estimate === 'function' ? estimate(request, url) : json(estimate);
    if (url.pathname.endsWith('/private-view/close')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/private-view')) return json(window_);
    if (url.pathname.endsWith('/service-lines')) return json(linesPage([fullLine, cancelledLine]));
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    return undefined;
  });
}
const openPersonal = (onLeave: () => void = () => undefined) =>
  renderWork(<MyWorkScreen context={personal} onLeave={onLeave} />);
const openReception = async (onLeave: () => void = () => undefined) => {
  renderWork(<MyWorkScreen context={reception} onLeave={onLeave} />);
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
  expect(await screen.findByText('Haircut')).toBeTruthy();
};
const correctionBlock = () => {
  const section = screen
    .getByRole('heading', { name: label('myWork.correctionTitle') })
    .closest('section');
  if (section === null) throw new Error('correction section missing');
  return within(section);
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows the estimated total and a commission only on the lines that still count, never on a cancelled one', async () => {
  serve(openEstimate());
  openPersonal();
  expect(await screen.findByText(label('myWork.estimateTitle'))).toBeTruthy();
  expect(screen.getByText(label('myWork.estimateTotal'))).toBeTruthy();
  expect(screen.getByText('6.750')).toBeTruthy();
  expect(screen.getAllByText(label('myWork.lineCommission')).length).toBe(1);
  expect(screen.getByText('4.250')).toBeTruthy();
  expect(screen.queryByText('2.500')).toBeNull();
  expect(screen.queryByText(label('myWork.estimateRecalculated'))).toBeNull();
});

it('tells her the calculation changed when the server recalculated the estimate', async () => {
  serve(openEstimate(true));
  openPersonal();
  expect(await screen.findByText(label('myWork.estimateRecalculated'))).toBeTruthy();
});

it('shows no card and no line commission when the estimate is hidden, while her lines stay visible', async () => {
  serve(hiddenEstimate());
  openPersonal();
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(label('myWork.loading'))).toBeNull());
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
  expect(screen.queryByText(label('myWork.lineCommission'))).toBeNull();
});

it.each([
  ['no plan', noPlanEstimate],
  ['no salary', noSalaryEstimate],
])(
  'says there is no commission plan yet with no amount when the status is %s',
  async (_name, build) => {
    serve(build());
    openPersonal();
    expect(await screen.findByText(label('myWork.estimateNoPlan'))).toBeTruthy();
    expect(screen.queryByText(label('myWork.estimateTotal'))).toBeNull();
    expect(screen.queryByText(label('myWork.lineCommission'))).toBeNull();
  },
);

it('shows the approved badge and the approved amount without a per-line commission', async () => {
  serve(approvedEstimate());
  openPersonal();
  expect(await screen.findByText(label('myWork.estimateApproved'))).toBeTruthy();
  expect(screen.getByText(label('myWork.estimateApprovedAmount'))).toBeTruthy();
  expect(screen.getByText('8.125')).toBeTruthy();
  expect(screen.queryByText(label('myWork.lineCommission'))).toBeNull();
});

it('lists a correction the way the manager sees it, with the service only for a line correction', async () => {
  serve(noPlanEstimate([lineCorrection(), saleCorrection()]));
  openPersonal();
  await screen.findByText(label('myWork.estimateNoPlan'));
  const block = correctionBlock();
  expect(block.getByText('2026-10')).toBeTruthy();
  expect(block.getByText(formatBusinessDate('2026-10-15', 'en'))).toBeTruthy();
  expect(block.getByText('Shampoo')).toBeTruthy();
  for (const amount of ['3.000', '1.500', '-1.500', '2.000', '2.750', '0.750'])
    expect(block.getByText(amount)).toBeTruthy();
  expect(block.getAllByText(label('myWork.service')).length).toBe(1);
  expect(block.getAllByText(label('myWork.correctionSourceMonth')).length).toBe(2);
  expect(block.queryByText(label('myWork.customer'))).toBeNull();
});

it('keeps corrections next to the approved amount', async () => {
  serve(approvedEstimate([saleCorrection()]));
  openPersonal();
  await screen.findByText(label('myWork.estimateApproved'));
  expect(correctionBlock().getByText('2026-09')).toBeTruthy();
});

it('asks for the shown month explicitly and drops the old estimate while another month loads', async () => {
  const fetched = serve((_request, url) =>
    json(url.searchParams.get('month') === '2026-10' ? noPlanEstimate() : openEstimate()),
  );
  openPersonal();
  expect(await screen.findByText('6.750')).toBeTruthy();
  expect(fetched.paths('/commission-estimate')[0]?.url).toContain('month=2026-11');
  fireEvent.click(screen.getByRole('button', { name: label('myWork.previousMonth') }));
  expect(await screen.findByText(label('myWork.estimateNoPlan'))).toBeTruthy();
  expect(screen.queryByText('6.750')).toBeNull();
  expect(fetched.paths('/commission-estimate').at(-1)?.url).toContain('month=2026-10');
});

it('hides only the card when commissions are switched off for her, and keeps her lines and the screen open', async () => {
  const onLeave = vi.fn();
  serve(() => json({ code: 'FORBIDDEN' }, 403));
  openPersonal(onLeave);
  expect(await screen.findByText('Haircut')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText(label('myWork.loading'))).toBeNull());
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
  expect(screen.queryByText(label('myWork.refused'))).toBeNull();
  expect(onLeave).not.toHaveBeenCalled();
});

it('leaves the screen when the session ended while the estimate was read', async () => {
  const onLeave = vi.fn();
  serve(() => json({ code: 'UNAUTHENTICATED' }, 401));
  openPersonal(onLeave);
  await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
});

it('shows the estimate card in Arabic on her own phone', async () => {
  serve(noPlanEstimate());
  renderWork(<MyWorkScreen context={personal} onLeave={() => undefined} />, 'ar');
  expect(await screen.findByText(t('ar', 'myWork.estimateNoPlan'))).toBeTruthy();
  expect(screen.getByText(t('ar', 'myWork.estimateTitle'))).toBeTruthy();
});

it('shows the card and the line commission on the reception device and reads the estimate under the window', async () => {
  const fetched = serve(openEstimate());
  await openReception();
  expect(await screen.findByText('6.750')).toBeTruthy();
  expect(screen.getAllByText(label('myWork.lineCommission')).length).toBe(1);
  expect(fetched.paths('/commission-estimate')[0]?.headers.get('x-private-view-window-id')).toBe(
    'window-abc',
  );
  expect(fetched.paths('/commission-estimate')[0]?.url).toContain('month=2026-11');
});

it('keeps the reception window open with her lines when commissions are off for her', async () => {
  serve(() => json({ code: 'FORBIDDEN' }, 403));
  await openReception();
  await waitFor(() => expect(screen.queryByText(label('myWork.loading'))).toBeNull());
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
  expect(screen.getByText('Haircut')).toBeTruthy();
});

it('keeps the reception window open when the estimate service is down', async () => {
  serve(() => json({ code: 'UNAVAILABLE' }, 503));
  await openReception();
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
  expect(screen.queryByLabelText(label('myWork.pinLabel'))).toBeNull();
});

it('returns to the PIN step with her private data gone when the window expired during the estimate read', async () => {
  serve(() => json({ code: 'PRIVATE_VIEW_EXPIRED' }, 403));
  renderWork(<MyWorkScreen context={reception} onLeave={() => undefined} />);
  fireEvent.change(await screen.findByLabelText(label('myWork.pinLabel')), {
    target: { value: '4321' },
  });
  fireEvent.click(screen.getByText(label('myWork.pinSubmit')));
  expect(await screen.findByLabelText(label('myWork.pinLabel'))).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Haircut')).toBeNull());
  expect(screen.queryByText(label('myWork.estimateTitle'))).toBeNull();
});

it('clears the estimate on the reception device when she steps to another month and shows the new one', async () => {
  serve((_request, url) =>
    json(url.searchParams.get('month') === '2026-10' ? noPlanEstimate() : openEstimate()),
  );
  await openReception();
  expect(await screen.findByText('6.750')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: label('myWork.previousMonth') }));
  expect(await screen.findByText(label('myWork.estimateNoPlan'))).toBeTruthy();
  expect(screen.queryByText('6.750')).toBeNull();
});
