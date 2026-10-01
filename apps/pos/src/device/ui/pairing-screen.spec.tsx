import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { PairingScreen } from './pairing-screen';

describe('pairing screen', () => {
  it('renders the Arabic pairing heading from right to left', () => {
    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <PairingScreen notice={null} onSubmit={() => Promise.resolve(null)} />
        </LocaleProvider>
      </DirectionProvider>,
    );
    const heading = screen.getByRole('heading', { name: t('ar', 'pos.pairingTitle') });
    expect(heading.closest('[dir="rtl"]')).not.toBeNull();
  });
});
