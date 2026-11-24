import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ok, refusal } from '../../api/__tests__/plan-http';
import {
  PERIOD,
  EMPLOYEE_RANA,
  branchView,
  businessView,
  correctionRow,
  dyeRow,
  statementEmployee,
  statementRow,
} from '../../api/__tests__/statement-http';
import { renderStatementPage, serveReading } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);
const current = { answer: ok(businessView()) };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  current.answer = ok(businessView());
  serveReading(api, current);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('opens on the last finished month and shows the draft with each employee and her totals', async () => {
  renderStatementPage();
  expect(screen.getByRole('status').textContent).toBe(S('loading'));
  const card = await screen.findByLabelText('Sara');
  expect(within(card).getByText('12.500')).toBeTruthy();
  expect(within(card).getByText('3.000')).toBeTruthy();
  expect(within(card).getByText('15.500')).toBeTruthy();
  expect((screen.getByLabelText(S('monthLabel')) as HTMLInputElement).value).toBe(PERIOD);
  expect(screen.getByText(S('statusDraft'))).toBeTruthy();
  expect(api.GET.mock.calls[0]?.[1].params.path).toEqual({ businessId: expect.any(String), period: PERIOD });
});

it('shows the work table with the service, the full customer name and the branch', async () => {
  current.answer = ok(businessView({ employees: [statementEmployee({ rows: [dyeRow()] })] }));
  renderStatementPage();
  const table = await screen.findByRole('table');
  const cells = within(table).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells).toEqual([
    '2026-10-12',
    t('en', 'commissionStatement.kindCommission'),
    'Dyeing',
    'Noura Al-Test',
    'Salmiya',
    '20.000',
  ]);
});

it('shows a statement that was never generated with its own status and the generate button only', async () => {
  current.answer = ok(businessView({ generated: false }));
  renderStatementPage();
  expect(await screen.findByText(S('emptyTitle'))).toBeTruthy();
  expect(screen.getByText(S('statusNone'))).toBeTruthy();
  expect(screen.getByRole('button', { name: S('generate') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('review') })).toBeNull();
  expect(screen.queryByRole('button', { name: S('returnToDraft') })).toBeNull();
});

it('lists a missing plan on the employee and keeps review closed until it is fixed', async () => {
  const issues = [{ kind: 'PRICING' as const, code: 'NO_PLAN' as const, source_period: null }];
  current.answer = ok(businessView({ employees: [statementEmployee({ issues })] }));
  renderStatementPage();
  expect(await screen.findByText(S('issueNoPlan'))).toBeTruthy();
  expect((screen.getByRole('button', { name: S('review') }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows a blocked correction with the month it came from', async () => {
  const issues = [{ kind: 'BLOCKED_CORRECTION' as const, code: 'NO_PLAN' as const, source_period: '2026-09' }];
  current.answer = ok(businessView({ employees: [statementEmployee({ issues })] }));
  renderStatementPage();
  expect(await screen.findByText(`${S('issueBlockedCorrection')} 2026-09`)).toBeTruthy();
});

it('CS-Q9: shows previous-month corrections in their own section with one row per service and a total', async () => {
  const rows = [
    correctionRow('correction:1', '-6.000', '20.000', '14.000'),
    correctionRow('correction:2', '-4.000', '10.000', '6.000'),
  ];
  current.answer = ok(businessView({ employees: [statementEmployee({ rows })] }));
  renderStatementPage();
  await screen.findByRole('heading', { name: S('sectionCorrections') });
  const body = screen.getAllByRole('row').slice(1);
  expect(body.map((row) => within(row).getAllByRole('cell').map((c) => c.textContent))).toEqual([
    ['2026-09-20', 'Dyeing', '2026-09', '20.000', '14.000', '-6.000'],
    ['2026-09-20', 'Dyeing', '2026-09', '10.000', '6.000', '-4.000'],
  ]);
  expect(screen.getByText(S('correctionsTotal')).parentElement?.textContent).toContain('-10.000');
});

it('keeps cash-tip corrections out of the corrections total', async () => {
  const rows = [
    correctionRow('correction:1', '-6.000', '20.000', '14.000'),
    statementRow('correction:2', 'CORRECTION_TIP_CASH', '-9.000', { source_period: '2026-09', business_date: '2026-09-21' }),
  ];
  current.answer = ok(businessView({ employees: [statementEmployee({ rows })] }));
  renderStatementPage();
  const total = await screen.findByText(S('correctionsTotal'));
  expect(total.parentElement?.textContent).toBe(`${S('correctionsTotal')}-6.000`);
});

it('shows a reviewed statement that changed since the review with its cause and the return as the next step', async () => {
  current.answer = ok(
    businessView({ status: 'REVIEWED', changed_since_review: true, change_cause: 'STATEMENT' }),
  );
  renderStatementPage();
  expect(await screen.findByText(S('changedStatement'))).toBeTruthy();
  expect(screen.getByText(S('statusReviewed'))).toBeTruthy();
  expect(screen.getByRole('button', { name: S('returnToDraft') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('review') })).toBeNull();
});

it('gives a branch reader her partial employees with no action buttons', async () => {
  current.answer = ok(branchView());
  renderStatementPage();
  expect(await screen.findByText(S('branchReaderNote'))).toBeTruthy();
  expect(screen.getByText(S('partialBadge'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('generate') })).toBeNull();
  expect(screen.queryByRole('button', { name: S('review') })).toBeNull();
  expect(screen.queryByRole('button', { name: S('returnToDraft') })).toBeNull();
});

it('shows only the employees the server returned', async () => {
  current.answer = ok(businessView({ employees: [statementEmployee({ employee_id: EMPLOYEE_RANA, name_en: 'Rana' })] }));
  renderStatementPage();
  expect(await screen.findByLabelText('Rana')).toBeTruthy();
  expect(screen.queryByLabelText('Sara')).toBeNull();
});

it('shows a no-permission state without numbers or buttons when the read is refused', async () => {
  current.answer = refusal(403, 'FORBIDDEN');
  renderStatementPage();
  expect(await screen.findByText(S('deniedTitle'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('generate') })).toBeNull();
  expect(screen.queryByLabelText('Sara')).toBeNull();
});

it('shows a disabled feature as a readable error, not as a lost permission', async () => {
  current.answer = refusal(403, 'FEATURE_DISABLED');
  renderStatementPage();
  expect(await screen.findByText(S('errorTitle'))).toBeTruthy();
  expect(screen.getByText(S('errFeatureDisabled'))).toBeTruthy();
  expect(screen.queryByText(S('deniedTitle'))).toBeNull();
});

it('shows a load failure with a retry that brings the statement back', async () => {
  current.answer = { error: '', response: { status: 500, ok: false } };
  renderStatementPage();
  expect(await screen.findByText(S('errorTitle'))).toBeTruthy();
  current.answer = ok(businessView());
  fireEvent.click(screen.getByRole('button', { name: S('retry') }));
  expect(await screen.findByLabelText('Sara')).toBeTruthy();
});

it('shows an approved month as closed instead of a raw error while its frozen rows are not served', async () => {
  current.answer = refusal(409, 'COMMISSION_PERIOD_CLOSED');
  renderStatementPage();
  expect(await screen.findByText(S('closedTitle'))).toBeTruthy();
  expect(screen.queryByText('COMMISSION_PERIOD_CLOSED')).toBeNull();
});

it('shows the statement of the new month when the month picker changes', async () => {
  const september = businessView({
    period: '2026-09',
    employees: [statementEmployee({ employee_id: EMPLOYEE_RANA, name_en: 'Rana' })],
  });
  api.GET.mockImplementation(async (_path: string, options: { params: { path: { period: string } } }) =>
    options.params.path.period === '2026-09' ? ok(september) : current.answer,
  );
  renderStatementPage();
  await screen.findByLabelText('Sara');
  fireEvent.change(screen.getByLabelText(S('monthLabel')), { target: { value: '2026-09' } });
  expect(await screen.findByLabelText('Rana')).toBeTruthy();
  expect(screen.queryByLabelText('Sara')).toBeNull();
});
