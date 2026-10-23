import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceLocale } from './device-locale';

describe('deviceLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads Arabic from a phone set to Arabic', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ar-KW');

    expect(deviceLocale()).toBe('ar');
  });

  it('reads English from a phone set to any other language', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');

    expect(deviceLocale()).toBe('en');
  });
});
