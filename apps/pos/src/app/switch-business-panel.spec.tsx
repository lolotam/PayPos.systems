import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { SwitchBusinessPanel } from './switch-business-panel';

function mount(busy = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <SwitchBusinessPanel busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
    </LocaleProvider>,
  );
  return { onConfirm, onCancel };
}

describe('SwitchBusinessPanel', () => {
  it('asks one question and offers both answers', () => {
    mount();

    expect(screen.getByText(t('ar', 'nativeShell.switchBusinessConfirm'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') })).not.toBeNull();
  });

  it('says nothing about the role of the device', () => {
    mount();

    expect(screen.queryByText(t('ar', 'nativeShell.roleChangeOffline'))).toBeNull();
    expect(screen.queryByText(t('ar', 'nativeShell.roleChangeFailed'))).toBeNull();
  });

  it('disables both answers while the switch runs', () => {
    mount(true);

    const confirm = screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') });
    const cancel = screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(cancel.hasAttribute('disabled')).toBe(true);
  });

  it('reports the answer the employee gave', () => {
    const { onConfirm, onCancel } = mount();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
