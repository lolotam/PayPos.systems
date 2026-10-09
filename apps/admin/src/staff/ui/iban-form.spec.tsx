import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IbanForm } from './iban-form';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const current = {
  status: 'SET' as const,
  iban: 'KW81CBKU0000000000001234560101',
  iban_last4: '0101',
  bank_id: 'kw-cbk',
  holder_name_en: 'SYNTHETIC HOLDER',
  revision: 7,
  set_at: null,
  set_by: null,
  can_read_full: true,
  can_manage: true,
};
it('normalizes localized IBAN input, preselects the known bank and submits the displayed revision', async () => {
  const onSave = vi.fn();
  render(<IbanForm current={current} pending={false} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('IBAN'), {
    target: { value: 'kw' + String.fromCharCode(0x668, 0x661) + ' cbku 0000 0000 0000 1234 5601 01' },
  });
  expect((screen.getByLabelText('Bank') as HTMLSelectElement).value).toBe('kw-cbk');
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save bank account' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ iban: current.iban, expected_revision: 7, bank_id: 'kw-cbk' }),
    ),
  );
});
it('requires a reason and explicit confirmation before clearing all three values', async () => {
  const onSave = vi.fn();
  render(<IbanForm current={current} pending={false} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear bank account' }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing the bank account' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic clear' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing the bank account' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      iban: null,
      bank_id: null,
      holder_name_en: null,
      reason: 'Synthetic clear',
      expected_revision: 7,
    }),
  );
});
