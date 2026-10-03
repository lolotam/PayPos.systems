import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { CodeForm } from './code-form';
import { PhoneForm } from './phone-form';
import { PinForm } from './pin-form';

vi.mock('../api/use-pin-form', () => ({
  usePinForm: () => ({ pending: false, invalid: false, submit: vi.fn() }),
}));

it.each(['ar', 'en'] as const)(
  'renders phone, OTP and PIN controls at touch size in %s without CSS layer overrides',
  (locale) => {
    const { container } = render(
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <PhoneForm pending={false} onSubmit={vi.fn()} />
        <CodeForm
          challengeId="01920000-0000-7000-8000-000000000001"
          pending={false}
          onSubmit={vi.fn()}
        />
        <PinForm onSignedIn={vi.fn()} />
      </LocaleProvider>,
    );
    const controls = container.querySelectorAll('input, select, button');
    expect(controls).toHaveLength(8);
    for (const control of controls) {
      expect(control.classList.contains('min-h-12')).toBe(true);
      expect(control.classList.contains('min-h-11')).toBe(false);
      expect(
        control.classList.contains(control.tagName === 'BUTTON' ? 'text-lg' : 'text-base'),
      ).toBe(true);
    }
    const labels = container.querySelectorAll('label');
    expect(labels).toHaveLength(5);
    for (const label of labels) {
      expect(label.classList.contains('text-base')).toBe(true);
      expect(label.classList.contains('text-sm')).toBe(false);
    }
  },
);
