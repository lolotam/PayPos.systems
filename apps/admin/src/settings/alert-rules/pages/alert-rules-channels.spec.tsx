import { alertRulesText } from '../model/alert-rules-text';
import { t, type Locale } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
  kindRow,
  mockAlertRulesGet,
  renderPage,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

// AL-Q6 (صف 62b-1): قنوات الفريق الثلاث في شاشة القواعد، وملاحظة الواتساب ظاهرة جنب اختياره.
beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

const KIND = 'LOW_RATING';
const kindLabel = (language: Locale) => t(language, `alertRules.kind_${KIND}`);
const channelBox = (language: Locale, key: 'channelInApp' | 'channelEmail' | 'channelWhatsapp') =>
  within(kindRow(KIND, language)).getByRole('checkbox', {
    name: alertRulesText(t(language, 'alertRules.channelForKind'), {
      channel: t(language, `alertRules.${key}`),
      kind: kindLabel(language),
    }),
  }) as HTMLInputElement;

it.each(['en', 'ar'] as const)('shows the three channels of a team alert in %s, the in-app one on by default', async (language) => {
  locale.value = language;
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  await screen.findByRole('switch', { name: t(language, 'alertRules.masterLabel') });
  const group = within(kindRow(KIND, language)).getByRole('group', {
    name: t(language, 'alertRules.channelsLabel'),
  });
  expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
  expect(channelBox(language, 'channelInApp').checked).toBe(true);
  expect(channelBox(language, 'channelEmail').checked).toBe(false);
  expect(channelBox(language, 'channelWhatsapp').checked).toBe(false);
});

it.each(['en', 'ar'] as const)('shows the WhatsApp-not-enabled note right beside the WhatsApp choice in %s', async (language) => {
  locale.value = language;
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  await screen.findByRole('switch', { name: t(language, 'alertRules.masterLabel') });
  const note = within(kindRow(KIND, language)).getByText(
    t(language, 'alertRules.channelWhatsappUnconfiguredNote'),
  );
  expect(note.id).not.toBe('');
  expect(channelBox(language, 'channelWhatsapp').getAttribute('aria-describedby')).toBe(note.id);
  expect(note.textContent).toContain('CONFIG_INVALID');
  expect(t('ar', 'alertRules.channelWhatsappUnconfiguredNote')).not.toBe(
    t('en', 'alertRules.channelWhatsappUnconfiguredNote'),
  );
});

it('does not offer channels on the employee-only mobile reminder', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(
    within(kindRow('SHIFT_ENDS_SOON')).queryByRole('group', {
      name: t('en', 'alertRules.channelsLabel'),
    }),
  ).toBeNull();
});

it('saves the toggled channels, in canonical order, together with the rule', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  api.PUT.mockResolvedValue({
    data: withAlertRule(alertRulesFixture(), KIND, { channels: ['IN_APP', 'EMAIL', 'WHATSAPP'] }),
  });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(channelBox('en', 'channelWhatsapp'));
  fireEvent.click(channelBox('en', 'channelEmail'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(api.PUT).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: {
        rules: [
          expect.objectContaining({ kind: KIND, channels: ['IN_APP', 'EMAIL', 'WHATSAPP'] }),
        ],
      },
    }),
  );
});

it('saves a rule whose only channel is email, and unchecking every channel is a saved change too', async () => {
  const emailOnly = withAlertRule(alertRulesFixture(), KIND, { channels: ['EMAIL'] });
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: emailOnly })));
  api.PUT.mockResolvedValue({ data: emailOnly });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(channelBox('en', 'channelEmail').checked).toBe(true);
  expect(channelBox('en', 'channelInApp').checked).toBe(false);
  fireEvent.click(channelBox('en', 'channelEmail'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(api.PUT).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: { rules: [expect.objectContaining({ kind: KIND, channels: [] })] },
    }),
  );
});

it('sends nothing when the channels were not touched', async () => {
  api.GET.mockImplementation(mockAlertRulesGet(() => ({ data: alertRulesFixture() })));
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(channelBox('en', 'channelEmail'));
  fireEvent.click(channelBox('en', 'channelEmail'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.nothingChanged'))).toBeTruthy();
  expect(api.PUT).not.toHaveBeenCalled();
});
