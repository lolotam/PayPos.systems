import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LeaveRequestForm } from './leave-request-form';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const id = '01920000-0000-7000-8000-000000000101';
const branches = [
  {
    id,
    name_en: 'Synthetic branch',
    name_ar: null,
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
];
it.each(['ar', 'en'] as const)(
  'switches to partial leave, requires OTHER note and submits trimmed terms in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    const view = render(<LeaveRequestForm branches={branches} pending={false} onSave={save} />);
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.from')), {
      target: { value: '2027-01-01' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.kind')), {
      target: { value: 'PARTIAL' },
    });
    expect(screen.queryByLabelText(t(locale, 'leave.from'))).toBeNull();
    for (const [key, value] of [
      ['date', '2027-01-01'],
      ['start', '09:15'],
      ['end', '10:30'],
      ['type', 'OTHER'],
    ] as const)
      fireEvent.change(screen.getByLabelText(t(locale, `leave.${key}`)), { target: { value } });
    const form = view.container.querySelector('form');
    if (!form) throw new Error('Missing form');
    fireEvent.submit(form);
    await screen.findByRole('alert');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.note')), {
      target: { value: '  Synthetic note  ' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toEqual({
      kind: 'PARTIAL',
      date: '2027-01-01',
      start: '09:15',
      end: '10:30',
      type: 'OTHER',
      note: 'Synthetic note',
      branch_id: id,
    });
  },
);
it.each(['ar', 'en'] as const)(
  'shows settled limits in %s and never submits invalid terms',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    const view = render(<LeaveRequestForm branches={branches} pending={false} onSave={save} />);
    for (const [key, value] of [
      ['from', '2027-01-01'],
      ['to', '2027-04-01'],
    ] as const)
      fireEvent.change(screen.getByLabelText(t(locale, `leave.${key}`)), { target: { value } });
    const form = view.container.querySelector('form');
    if (!form) throw new Error('Missing form');
    fireEvent.submit(form);
    expect((await screen.findByRole('alert')).textContent).toBe(
      t(locale, 'errors.LEAVE_SPAN_TOO_LONG'),
    );
    fireEvent.change(screen.getByLabelText(t(locale, 'leave.kind')), {
      target: { value: 'PARTIAL' },
    });
    for (const [key, value] of [
      ['date', '2027-01-01'],
      ['start', '09:07'],
      ['end', '10:15'],
    ] as const)
      fireEvent.change(screen.getByLabelText(t(locale, `leave.${key}`)), { target: { value } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        t(locale, 'errors.LEAVE_TIME_STEP_INVALID'),
      ),
    );
    expect(save).not.toHaveBeenCalled();
  },
);
