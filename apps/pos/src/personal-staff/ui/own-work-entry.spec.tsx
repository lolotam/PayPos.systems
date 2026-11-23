import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { fullLine, hiddenTips, linesPage } from '@/my-work/ui/work-fixtures';
import { installFetch, json, renderWork } from '@/my-work/ui/work-test-kit';
import { PersonalWorkEntry } from './own-work-entry';
import { ReceptionWorkEntry } from './reception-work-entry';

vi.mock('@/shared/api/device-auth', () => ({ currentDeviceToken: async () => 'paired-device' }));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const personal = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  employee_id: id(4),
  expires_at: '2026-12-01T10:00:00.000Z',
};
const reception = {
  user_id: id(1),
  company_id: id(2),
  business_id: id(3),
  branch_id: id(5),
  device_id: id(6),
  expires_at: '2026-12-01T10:00:00.000Z',
};
const open = t('en', 'myWork.title');
const serve = (lines = () => json(linesPage([fullLine]))) =>
  installFetch((_, url) => {
    if (url.pathname.endsWith('/service-lines')) return lines();
    if (url.pathname.endsWith('/tips')) return json(hiddenTips());
    return undefined;
  });

afterEach(() => vi.unstubAllGlobals());

it('opens the work screen from the personal screen only when she asks for it and closes it again', async () => {
  const fetched = serve();
  renderWork(<PersonalWorkEntry session={personal} epoch={0} />);
  expect(fetched.requests.length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: open }));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'myWork.close') }));
  expect(screen.queryByText('Haircut')).toBeNull();
});

it('closes the screen when the session ends with a 401 while it is open', async () => {
  serve(() => json({ code: 'UNAUTHENTICATED' }, 401));
  renderWork(<PersonalWorkEntry session={personal} epoch={0} />);
  fireEvent.click(screen.getByRole('button', { name: open }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: open }).getAttribute('aria-expanded')).toBe('false'),
  );
});

it('comes back closed when the personal session epoch changes', async () => {
  serve();
  const view = renderWork(<PersonalWorkEntry session={personal} epoch={0} />);
  fireEvent.click(screen.getByRole('button', { name: open }));
  expect(await screen.findByText('Haircut')).toBeTruthy();
  view.rerenderWork(<PersonalWorkEntry session={personal} epoch={1} />);
  expect(screen.queryByText('Haircut')).toBeNull();
  expect(screen.getByRole('button', { name: open }).getAttribute('aria-expanded')).toBe('false');
});

it('asks the reception device operator for her PIN and drops it when another operator replaces her', async () => {
  serve();
  const view = renderWork(<ReceptionWorkEntry session={reception} epoch={0} />);
  fireEvent.click(screen.getByRole('button', { name: open }));
  expect(await screen.findByLabelText(t('en', 'myWork.pinLabel'))).toBeTruthy();
  view.rerenderWork(<ReceptionWorkEntry session={{ ...reception, user_id: id(7) }} epoch={1} />);
  expect(screen.queryByLabelText(t('en', 'myWork.pinLabel'))).toBeNull();
  expect(screen.getByRole('button', { name: open }).getAttribute('aria-expanded')).toBe('false');
});
