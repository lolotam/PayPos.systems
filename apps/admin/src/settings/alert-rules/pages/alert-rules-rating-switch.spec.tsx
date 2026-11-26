import { t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ratingSettingsKey } from '@/settings/alert-rules/api/alert-rules-client';
import {
  alertRulesFixture,
  businessId,
  companyId,
  mockAlertRulesGet,
  renderPage,
  userId,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const ratingSwitch = () =>
  screen.getByRole('switch', { name: t('en', 'alertRules.ratingRequestsLabel') }) as HTMLInputElement;

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('does not bring the old write failure back when the stored switch changes again', async () => {
  // قيمة المفتاح في السيرفر: مقفول، وبعد الكتابة الفاشلة بقت مفتوحة (الكتابة اتقبلت والرد ضاع)،
  // وبعدين مدير تاني رجّعها مقفولة.
  let stored = false;
  api.GET.mockImplementation(
    mockAlertRulesGet(
      () => ({ data: alertRulesFixture() }),
      () => ({ data: { requests_enabled: stored } }),
    ),
  );
  api.PUT.mockImplementation(async () => {
    stored = true;
    return {
      error: {
        code: 'INTERNAL',
        message_ar: 'Synthetic rating write failure',
        message_en: 'Synthetic rating write failure',
      },
      response: { status: 500 },
    };
  });
  const { client } = renderPage();
  const rating = (await screen.findByRole('switch', {
    name: t('en', 'alertRules.ratingRequestsLabel'),
  })) as HTMLInputElement;
  expect(rating.checked).toBe(false);
  fireEvent.click(ratingSwitch());
  // الكتابة وصلت للسيرفر والرد ضاع، فالقراءة الجديدة بتلاقي المفتاح مفتوح والخطأ بيختفي.
  await waitFor(() => expect(ratingSwitch().checked).toBe(true));
  expect(screen.queryByRole('alert')).toBeNull();
  // مدير تاني رجّع المفتاح مقفول في السيرفر.
  stored = false;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ratingSettingsKey(companyId, userId, businessId) });
  });
  await waitFor(() => expect(ratingSwitch().checked).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
});
