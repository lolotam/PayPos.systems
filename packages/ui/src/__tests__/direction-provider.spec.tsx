import { render, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { DirectionProvider, useDirection } from '../direction-provider.js';

it('defaults the DOM and Radix context to RTL', () => {
  const { container } = render(<DirectionProvider />);
  expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl');
  const { result } = renderHook(() => useDirection(), { wrapper: DirectionProvider });
  expect(result.current).toBe('rtl');
});

it('sets LTR on the root and updates direction when requested', () => {
  const { container, rerender } = render(<DirectionProvider dir="ltr" />);
  expect(container.firstElementChild?.getAttribute('dir')).toBe('ltr');
  rerender(<DirectionProvider dir="rtl" />);
  expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl');
});
