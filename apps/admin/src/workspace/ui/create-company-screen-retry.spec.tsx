import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/shared/api/query-client';
import {
  CREATED_COMPANY,
  ENVELOPE,
  POST_BODY,
  STORAGE_NAME,
  WORKSPACE_COMPANY,
  emptyWorkspaces,
  fillAndSubmit,
  jsonResponse,
  mockFetch,
  queue,
  renderScreen,
  seedAttempt,
  waitForForm,
} from './create-company-screen-support';

function testNetworkRetrySameKey(): void {
  it('a retry after a network failure locks the fields and resends the same key and body', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
    expect(nameInput.value).toBe('Rehearsal Salon');
    const retry = screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') });
    expect(retry.getAttribute('disabled')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
    expect(await posts[1]?.json()).toEqual(POST_BODY);
  });
}

function testServer500Retry(): void {
  it('a 500 shows its own message in the locked retry state and the retry answer is the one that lands', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'First refusal fixture'), 500),
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText('First refusal fixture')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    const retry = screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') });
    expect(retry.getAttribute('disabled')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(screen.queryByText('First refusal fixture')).toBeNull();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
  });
}

function testRemountKeepsAttempt(): void {
  it('an undecided attempt survives a remount and its retry reuses the same key', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    const first = renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('status')).not.toBeNull();
    first.unmount();
    renderScreen('en');
    const nameInput = await screen.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).readOnly).toBe(true);
    });
    expect((nameInput as HTMLInputElement).value).toBe('Rehearsal Salon');
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') }));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
    expect(await posts[1]?.json()).toEqual(POST_BODY);
  });
}

function testForbiddenAfterUnknown(): void {
  it('a 403 after an undecided attempt removes it, unlocks the form and the next submit uses a new key', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, emptyWorkspaces, emptyWorkspaces],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403),
        () => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') }));
    expect(await screen.findByText(t('en', 'admin.createCompanyForbidden'))).not.toBeNull();
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    await waitFor(() => {
      const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
      expect(nameInput.readOnly).toBe(false);
      expect(nameInput.value).toBe('Rehearsal Salon');
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    await waitFor(() => {
      expect(posts).toHaveLength(3);
    });
    expect(posts[2]?.headers.get('idempotency-key')).not.toBe(posts[1]?.headers.get('idempotency-key'));
  });
}

function testSuccessSurvivesRemount(): void {
  it('after a 201 with a failing refresh the success state survives a remount until the refresh lands', async () => {
    const client = createQueryClient();
    const { posts } = queue(
      [
        emptyWorkspaces,
        emptyWorkspaces,
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'Refresh failed fixture'), 500),
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'Refresh failed fixture'), 500),
        () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200),
      ],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    const first = renderScreen('en', client);
    await waitForForm();
    await fillAndSubmit();
    expect(await first.findByText(t('en', 'admin.createCompanyCreatedStatus'))).not.toBeNull();
    expect(first.queryByLabelText(t('en', 'admin.companyNameEnLabel'))).toBeNull();
    first.unmount();

    renderScreen('en', client);
    expect(await screen.findByText(t('en', 'admin.createCompanyCreatedStatus'))).not.toBeNull();
    expect(screen.queryByLabelText(t('en', 'admin.companyNameEnLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'admin.createCompanySubmit') })).toBeNull();
    expect(posts).toHaveLength(1);
    const reload = screen.getByRole('button', { name: t('en', 'admin.createCompanyReload') });
    fireEvent.click(reload);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
  });
}

function testCreatedMarkerOnFreshScreen(): void {
  it('a fresh screen that finds a created attempt of the same user shows the success state', async () => {
    const { posts } = queue([emptyWorkspaces]);
    seedAttempt({ created: true });
    renderScreen('en');
    expect(await screen.findByText(t('en', 'admin.createCompanyCreatedStatus'))).not.toBeNull();
    expect(screen.queryByLabelText(t('en', 'admin.companyNameEnLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'admin.createCompanySubmit') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'admin.createCompanyRetry') })).toBeNull();
    expect(posts).toHaveLength(0);
  });
}

function testForeignOrStaleAttempt(): void {
  it('another tab attempt locks a fresh screen, while a foreign or stale attempt is removed', async () => {
    queue([emptyWorkspaces, emptyWorkspaces, emptyWorkspaces]);
    seedAttempt();
    const first = renderScreen('en');
    const nameInput = await first.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).readOnly).toBe(true);
    });
    expect((nameInput as HTMLInputElement).value).toBe('Rehearsal Salon');
    expect(first.getByRole('button', { name: t('en', 'admin.createCompanyRetry') })).not.toBeNull();

    seedAttempt({ userId: 'another-user' });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_NAME }));
    await waitFor(() => {
      expect((first.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement).readOnly).toBe(false);
    });
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    first.unmount();

    seedAttempt({ userId: 'another-user' });
    const foreign = renderScreen('en');
    const foreignInput = await foreign.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    expect((foreignInput as HTMLInputElement).readOnly).toBe(false);
    expect((foreignInput as HTMLInputElement).value).toBe('');
    expect(
      foreign.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }).getAttribute('disabled'),
    ).toBeNull();
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    foreign.unmount();

    seedAttempt({ startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    const stale = renderScreen('en');
    const staleInput = await stale.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    expect((staleInput as HTMLInputElement).readOnly).toBe(false);
    expect((staleInput as HTMLInputElement).value).toBe('');
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    stale.unmount();
  });
}

function testRetryOnExpiredAttemptUnlocks(): void {
  it('a retry on an expired attempt unlocks the form with its values and sends no request', async () => {
    const { posts } = queue([emptyWorkspaces, emptyWorkspaces]);
    seedAttempt();
    renderScreen('en');
    const locked = await screen.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    await waitFor(() => {
      expect((locked as HTMLInputElement).readOnly).toBe(true);
    });
    // المحاولة بتنتهي بعد ما الشاشة اقفلت: الحالة المحلية لسه شايفة المقفول فزر «إعادة المحاولة» موجود،
    // والقراءة الجديدة وقت الإعادة هي اللي بتبين إنها انتهت.
    seedAttempt({ startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') }));
    await waitFor(() => {
      const input = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
      expect(input.readOnly).toBe(false);
      expect(input.value).toBe('Rehearsal Salon');
    });
    expect(screen.queryByRole('button', { name: t('en', 'admin.createCompanyRetry') })).toBeNull();
    expect(posts).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
  });
}

function testOfflineSubmit(): void {
  it('an offline submit fails at once into the locked retry state', async () => {
    const { posts } = queue(
      [emptyWorkspaces],
      [
        () => {
          throw new TypeError('offline');
        },
      ],
    );
    renderScreen('en');
    await waitForForm();
    onlineManager.setOnline(false);
    await fillAndSubmit();
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(await screen.findByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
  });
}

describe('CreateCompanyScreen retry and created marker', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    window.localStorage.clear();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  testNetworkRetrySameKey();
  testServer500Retry();
  testRemountKeepsAttempt();
  testForeignOrStaleAttempt();
  testForbiddenAfterUnknown();
  testSuccessSurvivesRemount();
  testCreatedMarkerOnFreshScreen();
  testRetryOnExpiredAttemptUnlocks();
  testOfflineSubmit();
});
