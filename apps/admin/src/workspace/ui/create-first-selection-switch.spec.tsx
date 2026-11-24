import { fireEvent, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUSINESS_ID,
  COMPANY_ID,
  CREATED_BUSINESS,
  OTHER_COMPANY_ID,
  SECOND_BUSINESS_ID,
  chooseCountry,
  companyWithTwoBusinessesNoBranch,
  fillBusinessAndSubmit,
  jsonResponse,
  mockFetch,
  queue,
  renderScreen,
  twoCompaniesWithoutBusiness,
  waitForBranchForm,
  waitForBusinessForm,
} from './create-first-screens-support';
import { WorkspaceChooseProbe } from './workspace-choose-probe';

function testFormResetsOnCompanySwitch(): void {
  it('switching the selected company empties the business form and the next POST carries the new company only', async () => {
    const { posts } = queue({
      gets: [twoCompaniesWithoutBusiness],
      posts: [() => jsonResponse(CREATED_BUSINESS, 201)],
    });
    const switchers = (
      <>
        <WorkspaceChooseProbe label="Company A" next={{ companyId: COMPANY_ID }} />
        <WorkspaceChooseProbe label="Company B" next={{ companyId: OTHER_COMPANY_ID }} />
      </>
    );
    renderScreen('en', <div data-testid="dashboard-content" />, undefined, false, switchers);
    fireEvent.click(await screen.findByRole('button', { name: 'Company A' }));
    await waitForBusinessForm();
    fireEvent.change(screen.getByLabelText(t('en', 'admin.businessNameEnLabel')), {
      target: { value: 'A Salon' },
    });
    await chooseCountry('Saudi Arabia');
    fireEvent.click(screen.getByRole('button', { name: 'Company B' }));
    await waitFor(() => {
      const nameInput = screen.getByLabelText(t('en', 'admin.businessNameEnLabel')) as HTMLInputElement;
      expect(nameInput.value).toBe('');
    });
    const typeSelect = screen.getByRole('combobox', { name: t('en', 'admin.businessTypeLabel') });
    expect(typeSelect.textContent).toBe(t('en', 'admin.verticalSalon'));
    const countrySelect = screen.getByRole('combobox', { name: t('en', 'admin.businessCountryLabel') });
    expect(countrySelect.textContent).toBe(t('en', 'admin.countryKW'));
    await fillBusinessAndSubmit('B Salon');
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]?.headers.get('x-company-id')).toBe(OTHER_COMPANY_ID);
    const sent = (await posts[0]?.text()) ?? '';
    expect(JSON.parse(sent)).toMatchObject({ name_en: 'B Salon' });
    expect(sent.includes('A Salon')).toBe(false);
  });
}

function testBranchFormResetsOnBusinessSwitch(): void {
  it('switching the selected business empties the branch form', async () => {
    queue({ gets: [companyWithTwoBusinessesNoBranch] });
    const switchers = (
      <>
        <WorkspaceChooseProbe
          label="Business 1"
          next={{ companyId: COMPANY_ID, businessId: BUSINESS_ID }}
        />
        <WorkspaceChooseProbe
          label="Business 2"
          next={{ companyId: COMPANY_ID, businessId: SECOND_BUSINESS_ID }}
        />
      </>
    );
    renderScreen('en', <div data-testid="dashboard-content" />, undefined, false, switchers);
    fireEvent.click(await screen.findByRole('button', { name: 'Business 1' }));
    await waitForBranchForm();
    fireEvent.change(screen.getByLabelText(t('en', 'admin.branchNameEnLabel')), {
      target: { value: 'A Branch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Business 2' }));
    await waitFor(() => {
      const nameInput = screen.getByLabelText(t('en', 'admin.branchNameEnLabel')) as HTMLInputElement;
      expect(nameInput.value).toBe('');
    });
    expect(screen.getByRole('heading', { name: t('en', 'admin.firstBranchTitle') })).not.toBeNull();
  });
}

describe('first-setup screens when the selection changes', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  testFormResetsOnCompanySwitch();
  testBranchFormResetsOnBusinessSwitch();
});
