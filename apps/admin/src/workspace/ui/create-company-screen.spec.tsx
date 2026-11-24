import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENVELOPE,
  CREATED_COMPANY,
  POST_BODY,
  STORAGE_NAME,
  WORKSPACE_COMPANY,
  emptyWorkspaces,
  fillAndSubmit,
  jsonResponse,
  mockFetch,
  queue,
  renderScreen,
  waitForForm,
} from './create-company-screen-support';

function testFormVisible(): void {
  it('a user with no company sees the create form in English and in Arabic (RTL)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      queue([emptyWorkspaces]);
      const { unmount } = renderScreen(locale);
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: t(locale, 'admin.createCompanyTitle') }),
        ).not.toBeNull();
      });
      expect(screen.getByLabelText(t(locale, 'admin.companyNameEnLabel'))).not.toBeNull();
      expect(screen.getByLabelText(t(locale, 'admin.companyNameArLabel'))).not.toBeNull();
      expect(
        screen.getByRole('button', { name: t(locale, 'admin.createCompanySubmit') }),
      ).not.toBeNull();
      unmount();
    }
  });
}

function testValidSubmit(): void {
  it('a valid submit sends one request with the names, the plan id and the key, then enters the new company', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY], capabilities: { staff_access: false } }, 200)],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    await waitFor(() => {
      // شركة منشأة من غير أنشطة بتفتح شاشة أول نشاط بدل لوحة الشركة (078).
      expect(screen.getByLabelText(t('en', 'admin.businessNameEnLabel'))).not.toBeNull();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/v1\/companies$/);
    expect(posts[0]?.headers.get('idempotency-key')).toMatch(/[0-9a-f-]{36}/);
    expect(await posts[0]?.json()).toEqual(POST_BODY);
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    expect(screen.queryByRole('heading', { name: t('en', 'admin.createCompanyTitle') })).toBeNull();
  });
}

function testEmptyEnglishName(): void {
  it('an empty English name shows the field error and sends no request', async () => {
    const { posts } = queue([emptyWorkspaces]);
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit('', 'Salon Rehearsal');
    expect(await screen.findByText(t('en', 'admin.nameEnRequired'))).not.toBeNull();
    expect(posts).toHaveLength(0);
  });
}

function testFieldErrorDescribed(): void {
  it('a field error is referenced by its input aria-describedby', async () => {
    queue([emptyWorkspaces]);
    renderScreen('en');
    await waitForForm();
    const input = screen.getByLabelText(t('en', 'admin.companyNameEnLabel'));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    const describedBy = await screen.findByText(t('en', 'admin.nameEnRequired'));
    expect(describedBy.getAttribute('id')).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(describedBy.getAttribute('id'));
  });
}

function testFirstRefusal(): void {
  it('a 403 refusal shows the alert, keeps the values and does not refetch workspaces', async () => {
    let reads = 0;
    const { posts } = queue(
      [
        () => {
          reads += 1;
          return emptyWorkspaces();
        },
      ],
      [() => jsonResponse({ ...ENVELOPE('FORBIDDEN', 'Refusal fixture'), details: [] }, 403)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.createCompanyForbidden'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.value).toBe('Rehearsal Salon');
    expect(posts).toHaveLength(1);
    // القراءة التانية هي حرس الإرسال (077): قراءة واحدة قبل الـ POST، وما فيش refetch بعد الرفض.
    expect(reads).toBe(2);
  });
}

function testGuardBlocksWhenCompanyExists(): void {
  it('a submit when the workspaces read now shows a company sends no POST and enters the dashboard', async () => {
    const { posts } = queue(
      [emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY], capabilities: { staff_access: false } }, 200)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    await waitFor(() => {
      // شركة منشأة من غير أنشطة بتفتح شاشة أول نشاط بدل لوحة الشركة (078).
      expect(screen.getByLabelText(t('en', 'admin.businessNameEnLabel'))).not.toBeNull();
    });
    expect(posts).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
  });
}

function testGuardFailureKeepsForm(): void {
  it('a failing workspaces read before the create shows the error and keeps the editable form', async () => {
    const { posts } = queue([
      emptyWorkspaces,
      () => jsonResponse(ENVELOPE('UNEXPECTED', 'Guard failed fixture'), 500),
    ]);
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText('Guard failed fixture')).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.readOnly).toBe(false);
    expect(nameInput.value).toBe('Rehearsal Salon');
    expect(posts).toHaveLength(0);
  });
}

function testStorageThrowing(): void {
  it('with storage throwing on every call the form works, sends one POST and shows the success state', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new TypeError('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new TypeError('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new TypeError('blocked');
    });
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText(t('en', 'admin.createCompanyCreatedStatus'))).not.toBeNull();
    expect(screen.queryByLabelText(t('en', 'admin.companyNameEnLabel'))).toBeNull();
    expect(posts).toHaveLength(1);
  });
}

describe('CreateCompanyScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    window.localStorage.clear();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  testFormVisible();
  testValidSubmit();
  testEmptyEnglishName();
  testFieldErrorDescribed();
  testFirstRefusal();
  testGuardBlocksWhenCompanyExists();
  testGuardFailureKeepsForm();
  testStorageThrowing();
});
