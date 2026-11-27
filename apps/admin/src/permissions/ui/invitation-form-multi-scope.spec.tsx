import { inviteMemberInput, type InviteMemberInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { InvitationForm } from './invitation-form';

// دعوة متعددة النطاقات (080): اختيار أكتر من فرع، «أدوار أكتر»، و«استثناء صلاحية» — كل واحدة
// بتظهر في الشاشة وبتطلع في الطلب بعقدها الصح.
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const COMPANY = '01920000-0000-7000-8000-0000000000c9';
const BRANCH_ONE = '01920000-0000-7000-8000-0000000000b1';
const BRANCH_TWO = '01920000-0000-7000-8000-0000000000b2';
const BUSINESS_ONE = '01920000-0000-7000-8000-0000000000a1';
const BUSINESS_TWO = '01920000-0000-7000-8000-0000000000a2';

const choices = {
  businesses: [
    { id: BUSINESS_ONE, name: 'North shop' },
    { id: BUSINESS_TWO, name: 'South shop' },
  ],
  branches: [
    { id: BRANCH_ONE, name: 'Salmiya' },
    { id: BRANCH_TWO, name: 'Hawally' },
  ],
};
const onSave = vi.fn();
const renderForm = () =>
  render(
    <InvitationForm
      companyId={COMPANY}
      choices={choices}
      disabled={false}
      pending={false}
      onSave={onSave}
    />,
  );

const fillBasics = () => {
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.emailLabel')), {
    target: { value: 'ahmed@example.test' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.nameLabel')), {
    target: { value: 'Ahmed' },
  });
  fireEvent.click(screen.getByLabelText(t('en', 'invitations.confirmTick')));
};
const submitButton = () =>
  screen.getByRole('button', { name: t('en', 'invitations.submit') }) as HTMLButtonElement;
const pickRole = (role: string) =>
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.roleLabel')), {
    target: { value: role },
  });
const pickScope = (id: string) =>
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.scopeLabel')), {
    target: { value: id },
  });
const sent = () => onSave.mock.calls[0]?.[0] as InviteMemberInput;

beforeEach(() => {
  onSave.mockClear();
});

it('a second branch joins the same invitation instead of a second one', async () => {
  renderForm();
  fillBasics();
  pickRole('branch_manager');
  pickScope(BRANCH_ONE);
  // القوائم بتظهر بعد ما يبقى في أكتر من فرع، والنطاق الأساسي ما بيتكررش.
  expect(screen.getByText(t('en', 'invitations.extraBranchesLabel'))).toBeTruthy();
  expect(screen.queryByLabelText('Salmiya')).toBeNull();
  fireEvent.click(screen.getByLabelText('Hawally'));
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent()).toMatchObject({
    role: 'branch_manager',
    scope: { type: 'BRANCH', id: BRANCH_ONE },
    additional_roles: [{ role: 'branch_manager', scope: { type: 'BRANCH', id: BRANCH_TWO } }],
  });
});

it('the extra business list shows for a business manager and keeps the primary scope out', async () => {
  renderForm();
  fillBasics();
  pickRole('business_manager');
  pickScope(BUSINESS_ONE);
  expect(screen.getByText(t('en', 'invitations.extraBusinessesLabel'))).toBeTruthy();
  fireEvent.click(screen.getByLabelText('South shop'));
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent().additional_roles).toEqual([
    { role: 'business_manager', scope: { type: 'BUSINESS', id: BUSINESS_TWO } },
  ]);
});

it('an extra role can be added and removed before the invitation goes out', async () => {
  renderForm();
  fillBasics();
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.extraRoleLabel')), {
    target: { value: 'business_manager' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.extraScopeLabel')), {
    target: { value: BUSINESS_ONE },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.addRole') }));
  // السطر الجديد ظاهر وله زر شيل.
  expect(screen.getByRole('button', { name: t('en', 'invitations.removeRole') })).toBeTruthy();
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent().additional_roles).toEqual([
    { role: 'business_manager', scope: { type: 'BUSINESS', id: BUSINESS_ONE } },
  ]);

  onSave.mockClear();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.removeRole') }));
  expect(screen.queryByRole('button', { name: t('en', 'invitations.removeRole') })).toBeNull();
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent().additional_roles).toBeUndefined();
});

it('an inline permission exception is added, shown, and sent with the invitation', async () => {
  renderForm();
  fillBasics();
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overridePermissionLabel')), {
    target: { value: 'create:customers:branch' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeTypeLabel')), {
    target: { value: 'BRANCH' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideScopeIdLabel')), {
    target: { value: BRANCH_ONE },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.overrideReasonLabel')), {
    target: { value: 'covering the launch' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.addOverride') }));
  expect(screen.getByRole('button', { name: t('en', 'invitations.removeOverride') })).toBeTruthy();
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent().permission_overrides).toEqual([
    {
      permission_code: 'create:customers:branch',
      effect: 'ALLOW',
      scope_type: 'BRANCH',
      scope_id: BRANCH_ONE,
      reason: 'covering the launch',
      expires_at: null,
    },
  ]);
});

it('a plain invitation still sends the old payload, and the server contract accepts it', async () => {
  renderForm();
  fillBasics();
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(sent()).toEqual({
    email: 'ahmed@example.test',
    name: 'Ahmed',
    role: 'accountant',
    scope: { type: 'COMPANY', id: COMPANY },
    email_confirmed: true,
  });
  expect(inviteMemberInput.safeParse(sent()).success).toBe(true);
});
