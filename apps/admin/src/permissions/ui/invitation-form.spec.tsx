import { t } from '@pospay/i18n';
import type { InviteMemberInput } from '@pospay/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { InvitationForm } from './invitation-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

// النموذج بيثبّت قاعدة التأكيد (D10): الإيميل كامل ظاهر قبل الإرسال، وزر الإرسال مقفول من غير
// علامة التأكيد، والطلب ما بيتبعثش إلا بشكل العقد الصحيح.
const choices = {
  businesses: [{ id: 'business-1', name: 'Salon one' }],
  branches: [{ id: 'branch-1', name: 'Salmiya' }],
};
const onSave = vi.fn();
const renderForm = (pending = false) =>
  render(
    <InvitationForm
      companyId="01920000-0000-7000-8000-0000000000c9"
      choices={choices}
      disabled={false}
      pending={pending}
      onSave={onSave}
    />,
  );

const fillEmail = (email: string) => {
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.emailLabel')), {
    target: { value: email },
  });
};
const fillName = () => {
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.nameLabel')), {
    target: { value: 'Ahmed' },
  });
};
const submitButton = () => screen.getByRole('button', { name: t('en', 'invitations.submit') }) as HTMLButtonElement;
const tick = () => screen.getByLabelText(t('en', 'invitations.confirmTick')) as HTMLInputElement;

it('shows the full email beside the mandatory confirmation before it can post', () => {
  renderForm();
  fillEmail('ahmed@example.test');
  fillName();
  expect(screen.getByTestId('confirm-email').textContent).toBe('ahmed@example.test');
  expect(tick().checked).toBe(false);
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(tick());
  expect(submitButton().disabled).toBe(false);
});

it('changing the email clears the confirmation tick again', () => {
  renderForm();
  fillEmail('ahmed@example.test');
  fillName();
  fireEvent.click(tick());
  expect(submitButton().disabled).toBe(false);
  fillEmail('ahmed2@example.test');
  expect(screen.getByTestId('confirm-email').textContent).toBe('ahmed2@example.test');
  expect(submitButton().disabled).toBe(true);
});

it('posts the contract-shaped input once the accountant scope is the company', async () => {
  renderForm();
  fillEmail('ahmed@example.test');
  fillName();
  fireEvent.click(tick());
  fireEvent.click(submitButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const input = onSave.mock.calls[0]?.[0] as InviteMemberInput;
  expect(input).toMatchObject({
    email: 'ahmed@example.test',
    name: 'Ahmed',
    role: 'accountant',
    scope: { type: 'COMPANY', id: '01920000-0000-7000-8000-0000000000c9' },
    email_confirmed: true,
  });
});

it('a branch manager needs a branch scope picked before it can post', () => {
  renderForm();
  fillEmail('bm@example.test');
  fillName();
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.roleLabel')), {
    target: { value: 'branch_manager' },
  });
  fireEvent.click(tick());
  expect(submitButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(t('en', 'invitations.scopeLabel')), {
    target: { value: 'branch-1' },
  });
  expect(submitButton().disabled).toBe(false);
});

it('a pending invitation never re-enables the button', () => {
  renderForm(true);
  fillEmail('ahmed@example.test');
  fillName();
  fireEvent.click(tick());
  expect(submitButton().disabled).toBe(true);
});
