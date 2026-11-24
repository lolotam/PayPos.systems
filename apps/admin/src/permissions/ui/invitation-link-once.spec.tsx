import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { InvitationLinkOnce } from './invitation-link-once';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

// الرابط مرة واحدة: نصه ظاهر مع زر نسخ بيأكد النسخ، والاخفاء بيشيله من الشاشة تماماً —
// الحالة معلقة على المكوّن نفسه فمفيش كاش بيرجّعه.
const writeText = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('navigator', { clipboard: { writeText } });

const renderLink = (onDismiss = vi.fn()) => {
  render(<InvitationLinkOnce link="http://api.test/v1/auth/reset-password/secret-token" onDismiss={onDismiss} />);
  return onDismiss;
};

it('shows the link once with a copy button that confirms the copy', async () => {
  renderLink();
  expect(screen.getByText('http://api.test/v1/auth/reset-password/secret-token')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.copy') }));
  expect(writeText).toHaveBeenCalledWith('http://api.test/v1/auth/reset-password/secret-token');
  expect(await screen.findByText(t('en', 'invitations.copied'))).toBeDefined();
});

it('hides the link entirely on dismiss, so it is never shown again', () => {
  const Harness = () => {
    const [shown, setShown] = useState(true);
    return shown ? (
      <InvitationLinkOnce
        link="http://api.test/v1/auth/reset-password/secret-token"
        onDismiss={() => setShown(false)}
      />
    ) : (
      <p>gone</p>
    );
  };
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'invitations.dismiss') }));
  expect(screen.queryByText('http://api.test/v1/auth/reset-password/secret-token')).toBeNull();
});
