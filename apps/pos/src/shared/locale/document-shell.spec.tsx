import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocale } from '@/shared/locale/locale-context';
import { isNativeShell } from '@/shared/platform/native-shell';

import { DocumentShell } from './document-shell';

vi.mock('@/shared/platform/native-shell', () => ({
  isNativeShell: vi.fn(),
}));

function Probe() {
  const locale = useLocale();
  return <p>{locale === 'ar' ? 'arabic' : 'english'}</p>;
}

function mount() {
  render(
    <DocumentShell>
      <Probe />
    </DocumentShell>,
  );
}

describe('DocumentShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens in Arabic on a native build with an Arabic phone', () => {
    vi.mocked(isNativeShell).mockReturnValue(true);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ar-KW');

    mount();

    expect(screen.getByText('arabic')).not.toBeNull();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('opens in English on a native build with a phone in another language', () => {
    vi.mocked(isNativeShell).mockReturnValue(true);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');

    mount();

    expect(screen.getByText('english')).not.toBeNull();
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('keeps the language the user chose over the phone language', () => {
    vi.mocked(isNativeShell).mockReturnValue(true);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');
    localStorage.setItem('pospay.locale', 'ar');

    mount();

    expect(screen.getByText('arabic')).not.toBeNull();
    expect(document.documentElement.lang).toBe('ar');
  });

  it('keeps the web build in Arabic whatever the phone language is', () => {
    vi.mocked(isNativeShell).mockReturnValue(false);
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');

    mount();

    expect(screen.getByText('arabic')).not.toBeNull();
    expect(document.documentElement.lang).toBe('ar');
  });
});
