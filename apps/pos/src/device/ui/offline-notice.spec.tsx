import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { OfflineNotice } from './offline-notice';

describe('OfflineNotice', () => {
  it('renders its i18n texts in Arabic and English', () => {
    const { rerender } = render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <OfflineNotice onRetry={() => Promise.resolve()} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(screen.getByRole('heading', { name: t('ar', 'pos.offlineTitle') })).not.toBeNull();
    expect(screen.getByText(t('ar', 'pos.offlineLead'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'pos.retry') })).not.toBeNull();

    rerender(
      <DirectionProvider dir="ltr">
        <LocaleProvider locale="en" setLocale={() => undefined}>
          <OfflineNotice onRetry={() => Promise.resolve()} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(screen.getByRole('heading', { name: t('en', 'pos.offlineTitle') })).not.toBeNull();
    expect(screen.getByText(t('en', 'pos.offlineLead'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'pos.retry') })).not.toBeNull();
  });

  it('calls onRetry handler when retry button is clicked', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <OfflineNotice onRetry={onRetry} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.retry') }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
