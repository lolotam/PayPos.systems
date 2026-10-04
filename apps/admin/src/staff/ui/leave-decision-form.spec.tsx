import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LeaveDecisionForm } from './leave-decision-form';
import { LeaveRevocationForm } from './leave-revocation-form';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
it.each(['ar', 'en'] as const)(
  'requires a trimmed rejection/revocation reason in %s and preserves revision',
  async (locale) => {
    state.locale = locale;
    for (const revocation of [false, true]) {
      const save = vi.fn();
      const view = render(
        revocation ? (
          <LeaveRevocationForm revision={2} pending={false} onSave={save} onClose={vi.fn()} />
        ) : (
          <LeaveDecisionForm
            decision="REJECTED"
            revision={1}
            pending={false}
            onSave={save}
            onClose={vi.fn()}
          />
        ),
      );
      const form = view.container.querySelector('form');
      if (!form) throw new Error('Missing form');
      fireEvent.submit(form);
      await screen.findByRole('alert');
      expect(save).not.toHaveBeenCalled();
      fireEvent.change(
        screen.getByLabelText(t(locale, revocation ? 'leave.revocationReason' : 'leave.reason')),
        { target: { value: '  Synthetic reason  ' } },
      );
      fireEvent.submit(form);
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(save.mock.calls[0]?.[0]).toEqual({
        expected_revision: revocation ? 2 : 1,
        reason: 'Synthetic reason',
        ...(revocation ? {} : { decision: 'REJECTED' }),
      });
      view.unmount();
    }
  },
);
it('approval accepts no reason and a pending mutation disables input and submit', async () => {
  state.locale = 'en';
  const save = vi.fn();
  const view = render(
    <LeaveDecisionForm
      decision="APPROVED"
      revision={3}
      pending={false}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.approve') }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0]).toMatchObject({ decision: 'APPROVED', expected_revision: 3 });
  view.rerender(
    <LeaveDecisionForm decision="APPROVED" revision={3} pending onSave={save} onClose={vi.fn()} />,
  );
  expect(view.container.querySelector('fieldset')?.disabled).toBe(true);
});
