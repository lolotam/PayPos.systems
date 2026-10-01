import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { WaitingScreen } from './waiting-screen';

describe('WaitingScreen', () => {
  it('renders its i18n texts in Arabic and English', () => {
    const { rerender } = render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <WaitingScreen onStartOver={() => Promise.resolve()} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(screen.getByRole('heading', { name: t('ar', 'pos.waitingTitle') })).not.toBeNull();
    expect(screen.getByText(t('ar', 'pos.waitingLead'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'pos.startOver') })).not.toBeNull();

    rerender(
      <DirectionProvider dir="ltr">
        <LocaleProvider locale="en" setLocale={() => undefined}>
          <WaitingScreen onStartOver={() => Promise.resolve()} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(screen.getByRole('heading', { name: t('en', 'pos.waitingTitle') })).not.toBeNull();
    expect(screen.getByText(t('en', 'pos.waitingLead'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'pos.startOver') })).not.toBeNull();
  });

  it('calls onStartOver handler when start over button is clicked', () => {
    const onStartOver = vi.fn().mockResolvedValue(undefined);
    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <WaitingScreen onStartOver={onStartOver} />
        </LocaleProvider>
      </DirectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.startOver') }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });
});
