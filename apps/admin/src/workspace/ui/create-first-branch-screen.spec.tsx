import { screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspace } from '../model/workspace-provider';
import {
  BRANCH_BODY,
  BUSINESS_ID,
  COMPANY_ID,
  CREATED_BRANCH,
  ENVELOPE,
  companyWithBusinessAndBranch,
  companyWithBusinessNoBranch,
  fillBranchAndSubmit,
  jsonResponse,
  mockFetch,
  queue,
  renderScreen,
  waitForBranchForm,
} from './create-first-screens-support';

function BranchProbe() {
  const workspace = useWorkspace();
  return (
    <div data-testid="dashboard-content">
      <span data-testid="dashboard-business">{workspace.business?.name_en ?? ''}</span>
      <span data-testid="dashboard-branch">{workspace.branch?.name_en ?? ''}</span>
    </div>
  );
}

function testBranchFormVisible(): void {
  it('a business with no branch sees the branch form', async () => {
    queue({ gets: [companyWithBusinessNoBranch] });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    expect(
      screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') }),
    ).not.toBeNull();
    expect(screen.getByLabelText(t('en', 'admin.branchNameEnLabel'))).not.toBeNull();
    expect(screen.getByLabelText(t('en', 'admin.branchNameArLabel'))).not.toBeNull();
    expect(
      screen.getByRole('button', { name: t('en', 'admin.firstBranchSubmit') }),
    ).not.toBeNull();
  });
}

function testValidSubmit(): void {
  it('a valid submit sends one POST to the branches route, then the dashboard appears with the business and branch selected', async () => {
    const { posts } = queue({
      gets: [
        companyWithBusinessNoBranch,
        companyWithBusinessNoBranch,
        companyWithBusinessAndBranch,
      ],
      posts: [() => jsonResponse(CREATED_BRANCH, 201)],
    });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    await fillBranchAndSubmit();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(new RegExp(`/v1/businesses/${BUSINESS_ID}/branches$`));
    expect(posts[0]?.headers.get('idempotency-key')).toMatch(/[0-9a-f-]{36}/);
    expect(posts[0]?.headers.get('x-company-id')).toBe(COMPANY_ID);
    expect(await posts[0]?.json()).toEqual(BRANCH_BODY);
    expect(screen.getByTestId('dashboard-business').textContent).toBe('Rehearsal Salon');
    expect(screen.getByTestId('dashboard-branch').textContent).toBe('Main Branch');
    expect(
      screen.queryByRole('heading', { name: t('en', 'admin.firstBranchTitle') }),
    ).toBeNull();
  });
}

function testBranchForbidden(): void {
  it('a 403 refusal shows the alert and keeps the values', async () => {
    const { posts } = queue({
      gets: [companyWithBusinessNoBranch, companyWithBusinessNoBranch],
      posts: [() => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403)],
    });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    await fillBranchAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.firstBranchForbidden'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.branchNameEnLabel')) as HTMLInputElement;
    expect(nameInput.value).toBe('Main Branch');
    expect(posts).toHaveLength(1);
  });
}

function testGuardBlocksWhenBranchExists(): void {
  it('a submit when the workspaces read now shows a branch sends no POST and enters the dashboard', async () => {
    const { posts } = queue({
      gets: [companyWithBusinessNoBranch, companyWithBusinessAndBranch],
    });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    await fillBranchAndSubmit();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(0);
  });
}

function testGuardFailureKeepsForm(): void {
  it('a failing workspaces read before the create shows the error and sends no POST', async () => {
    const { posts } = queue({
      gets: [
        companyWithBusinessNoBranch,
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'Guard failed fixture'), 500),
      ],
    });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    await fillBranchAndSubmit();
    expect(await screen.findByText('Guard failed fixture')).not.toBeNull();
    expect(posts).toHaveLength(0);
  });
}

function testEmptyEnglishName(): void {
  it('an empty English name shows the field error next to the field and sends no request', async () => {
    const { posts } = queue({ gets: [companyWithBusinessNoBranch] });
    renderScreen('en', <BranchProbe />);
    await waitForBranchForm();
    await fillBranchAndSubmit('', 'الفرع الرئيسي');
    const message = await screen.findByText(t('en', 'admin.branchNameRequired'));
    expect(message).not.toBeNull();
    const input = screen.getByLabelText(t('en', 'admin.branchNameEnLabel'));
    expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'));
    expect(posts).toHaveLength(0);
  });
}

describe('CreateFirstBranchScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  testBranchFormVisible();
  testValidSubmit();
  testBranchForbidden();
  testGuardBlocksWhenBranchExists();
  testGuardFailureKeepsForm();
  testEmptyEnglishName();
});
