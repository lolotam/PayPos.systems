import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AttendanceActionDialog } from './attendance-action-dialog';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
});

it.each(['button', 'escape', 'success'] as const)(
  'restores opener focus after %s closes the dialog',
  (method) => {
    const openerElement = <Button>{t('en', 'attendanceActions.history')}</Button>;
    const view = render(<StrictMode>{openerElement}</StrictMode>);
    const opener = screen.getByRole('button');
    opener.focus();
    const onClose = vi.fn(() => view.rerender(<StrictMode>{openerElement}</StrictMode>));
    view.rerender(
      <StrictMode>
        {openerElement}
        <AttendanceActionDialog title={t('en', 'attendanceActions.history')} onClose={onClose}>
          <Button onClick={onClose}>{t('en', 'attendanceActions.close')}</Button>
        </AttendanceActionDialog>
      </StrictMode>,
    );
    const close = screen.getByRole('button', { name: t('en', 'attendanceActions.close') });
    expect(document.activeElement).toBe(close);
    if (method === 'escape')
      fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    else if (method === 'button') fireEvent.click(close);
    else onClose();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  },
);

it('keeps focus in a pending dialog when Escape is refused', () => {
  const onClose = vi.fn();
  render(
    <AttendanceActionDialog title={t('en', 'attendanceActions.correct')} pending onClose={onClose}>
      <Button>{t('en', 'attendanceActions.save')}</Button>
    </AttendanceActionDialog>,
  );
  const focused = document.activeElement;
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(focused);
});
