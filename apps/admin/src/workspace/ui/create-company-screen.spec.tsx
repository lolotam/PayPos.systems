import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
      [emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
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
    expect(reads).toBe(1);
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
  });

  testFormVisible();
  testValidSubmit();
  testEmptyEnglishName();
  testFieldErrorDescribed();
  testFirstRefusal();
});
