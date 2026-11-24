import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspace } from '../model/workspace-provider';
import {
  BUSINESS_BODY,
  BUSINESS_ID,
  COMPANY_ID,
  CREATED_BUSINESS,
  ENVELOPE,
  chooseCountry,
  companyWithBusinessNoBranch,
  companyWithoutBusiness,
  fillBusinessAndSubmit,
  jsonResponse,
  mockFetch,
  queue,
  renderScreen,
  waitForBusinessForm,
} from './create-first-screens-support';
function BusinessProbe() {
  const workspace = useWorkspace();
  return (
    <div data-testid="dashboard-content">
      <span data-testid="dashboard-business">{workspace.business?.name_en ?? ''}</span>
      <span data-testid="dashboard-branch">{workspace.branch?.name_en ?? ''}</span>
    </div>
  );
}

function testFormVisible(): void {
  it('a company with no business sees the business form in English and in Arabic (RTL)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      queue();
      const { unmount } = renderScreen(locale, <BusinessProbe />);
      await waitForBusinessForm(locale);
      expect(
        screen.getByRole('heading', { name: t(locale, 'admin.firstBusinessTitle') }),
      ).not.toBeNull();
      const typeSelect = screen.getByRole('combobox', {
        name: t(locale, 'admin.businessTypeLabel'),
      });
      expect(typeSelect.textContent).toBe(t(locale, 'admin.verticalSalon'));
      expect(screen.getByLabelText(t(locale, 'admin.businessNameEnLabel'))).not.toBeNull();
      expect(screen.getByLabelText(t(locale, 'admin.businessNameArLabel'))).not.toBeNull();
      const countrySelect = screen.getByRole('combobox', {
        name: t(locale, 'admin.businessCountryLabel'),
      });
      expect(countrySelect.textContent).toBe(t(locale, 'admin.countryKW'));
      expect(
        screen.getByRole('button', { name: t(locale, 'admin.firstBusinessSubmit') }),
      ).not.toBeNull();
      unmount();
    }
  });
}

function testValidSubmit(): void {
  it('a valid submit sends one POST without country, currency or timezone, then one PUT, then shows the branch form', async () => {
    const { posts, puts } = queue({
      gets: [companyWithoutBusiness, companyWithoutBusiness, companyWithBusinessNoBranch],
      posts: [() => jsonResponse(CREATED_BUSINESS, 201)],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await chooseCountry('Saudi Arabia');
    await fillBusinessAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/v1\/businesses$/);
    expect(posts[0]?.headers.get('idempotency-key')).toMatch(/[0-9a-f-]{36}/);
    expect(posts[0]?.headers.get('x-company-id')).toBe(COMPANY_ID);
    expect(await posts[0]?.json()).toEqual(BUSINESS_BODY);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toMatch(new RegExp(`/v1/businesses/${BUSINESS_ID}/country$`));
    expect(await puts[0]?.json()).toEqual({ country: 'SA' });
  });
}

function testCountryPutFailure(): void {
  for (const failure of [
    {
      name: 'a 403 on the country PUT shows the alert, sends no second POST and continues to the branch form',
      answer: () => jsonResponse(ENVELOPE('FORBIDDEN', 'Country refused fixture'), 403),
    },
    {
      name: 'a network failure on the country PUT shows the alert, sends no second POST and continues to the branch form',
      answer: () => {
        throw new TypeError('network died');
      },
    },
  ]) {
    it(failure.name, async () => {
      // القراءة الثالثة (بتاعة الـ invalidation) متأجّلة: التنبيه بيفضل ظاهر لحد ما نسيبها تخلص،
      // بدل سباق مع تبديل الشاشة اللي بيحصل أول ما القراءة توصل.
      let releaseThirdRead = () => undefined;
      const deferredThirdRead = new Promise<Response>((resolve) => {
        releaseThirdRead = () => resolve(companyWithBusinessNoBranch());
      });
      const { posts } = queue({
        gets: [companyWithoutBusiness, companyWithoutBusiness, () => deferredThirdRead],
        posts: [() => jsonResponse(CREATED_BUSINESS, 201)],
        puts: [failure.answer],
      });
      renderScreen('en', <BusinessProbe />);
      await waitForBusinessForm();
      await fillBusinessAndSubmit();
      expect(await screen.findByText(t('en', 'admin.businessCountryNotSaved'))).not.toBeNull();
      expect(posts).toHaveLength(1);
      releaseThirdRead();
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
      });
      expect(posts).toHaveLength(1);
    });
  }
}

function testBusinessForbidden(): void {
  it('a 403 refusal shows the alert, keeps the values and sends no country PUT', async () => {
    const { posts, puts } = queue({
      gets: [companyWithoutBusiness, companyWithoutBusiness],
      posts: [() => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403)],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.firstBusinessForbidden'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.businessNameEnLabel')) as HTMLInputElement;
    expect(nameInput.value).toBe('Rehearsal Salon');
    expect(posts).toHaveLength(1);
    expect(puts).toHaveLength(0);
  });
}

function testGuardBlocksWhenBusinessExists(): void {
  it('a submit when the workspaces read now shows a business sends no POST and moves to the branch form', async () => {
    const { posts } = queue({
      gets: [companyWithoutBusiness, companyWithBusinessNoBranch],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
    });
    expect(posts).toHaveLength(0);
  });
}

function testGuardFailureKeepsForm(): void {
  it('a failing workspaces read before the create shows the error and sends no POST', async () => {
    const { posts } = queue({
      gets: [
        companyWithoutBusiness,
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'Guard failed fixture'), 500),
      ],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    expect(await screen.findByText('Guard failed fixture')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });
}

function testNetworkRetryReusesKey(): void {
  it('a retry after a network failure reuses the same key', async () => {
    const { posts } = queue({
      gets: [
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithBusinessNoBranch,
      ],
      posts: [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(CREATED_BUSINESS, 201),
      ],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    await fillBusinessAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers.get('idempotency-key')).toBe(posts[1]?.headers.get('idempotency-key'));
  });
}

function testConflictKeepsKey(): void {
  it('a 409 in-progress answer keeps the key for the retry', async () => {
    const { posts } = queue({
      gets: [
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithBusinessNoBranch,
      ],
      posts: [
        () => jsonResponse(ENVELOPE('IDEMPOTENCY_KEY_IN_PROGRESS', 'In progress fixture'), 409),
        () => jsonResponse(CREATED_BUSINESS, 201),
      ],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    expect(await screen.findByText('In progress fixture')).not.toBeNull();
    await fillBusinessAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers.get('idempotency-key')).toBe(posts[1]?.headers.get('idempotency-key'));
  });
}

function testForbiddenThenNewKey(): void {
  it('a 403 refusal releases the key so the next attempt uses a new one', async () => {
    const { posts } = queue({
      gets: [
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithoutBusiness,
        companyWithBusinessNoBranch,
      ],
      posts: [
        () => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403),
        () => jsonResponse(CREATED_BUSINESS, 201),
      ],
    });
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    await fillBusinessAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers.get('idempotency-key')).not.toBe(posts[1]?.headers.get('idempotency-key'));
  });
}

function testEmptyEnglishName(): void {
  it('an empty English name shows the field error next to the field and sends no request', async () => {
    const { posts } = queue();
    renderScreen('en', <BusinessProbe />);
    await waitForBusinessForm();
    await fillBusinessAndSubmit('', 'Salon Rehearsal');
    const message = await screen.findByText(t('en', 'admin.businessNameRequired'));
    expect(message).not.toBeNull();
    const input = screen.getByLabelText(t('en', 'admin.businessNameEnLabel'));
    expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'));
    expect(posts).toHaveLength(0);
  });
}

describe('CreateFirstBusinessScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  testFormVisible();
  testValidSubmit();
  testCountryPutFailure();
  testBusinessForbidden();
  testGuardBlocksWhenBusinessExists();
  testGuardFailureKeepsForm();
  testNetworkRetryReusesKey();
  testConflictKeepsKey();
  testForbiddenThenNewKey();
  testEmptyEnglishName();
});
