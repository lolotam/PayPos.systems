import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { parseNavigationStyle } from '../navigation-model';
import { clearNavStyleCookie, NAV_STYLE_COOKIE } from './nav-style-cookie';
import { NavStyleProvider, useNavStyle } from './nav-style-context';

function Probe() {
  const { style, setStyle } = useNavStyle();
  return (
    <>
      <p>Current style: {style}</p>
      <button type="button" onClick={() => setStyle('A')}>
        Pick A
      </button>
      <button type="button" onClick={() => setStyle('B')}>
        Pick B
      </button>
    </>
  );
}

function cookieValue(): string | undefined {
  return document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${NAV_STYLE_COOKIE}=`))
    ?.split('=')[1];
}

afterEach(clearNavStyleCookie);

it.each([undefined, null, '', 'D', 'a', 'AB'])('falls back to style C for the value %j', (raw) => {
  expect(parseNavigationStyle(raw)).toBe('C');
});

it.each(['A', 'B', 'C'] as const)('keeps the stored style %s', (raw) => {
  expect(parseNavigationStyle(raw)).toBe(raw);
});

it('starts from the style the server read', () => {
  render(
    <NavStyleProvider initialStyle="C">
      <Probe />
    </NavStyleProvider>,
  );
  expect(screen.getByText('Current style: C')).toBeTruthy();
  expect(cookieValue()).toBeUndefined();
});

it('changes the visible style and writes the cookie without a reload', () => {
  render(
    <NavStyleProvider initialStyle="C">
      <Probe />
    </NavStyleProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A' }));
  expect(screen.getByText('Current style: A')).toBeTruthy();
  expect(cookieValue()).toBe('A');
  fireEvent.click(screen.getByRole('button', { name: 'Pick B' }));
  expect(screen.getByText('Current style: B')).toBeTruthy();
  expect(cookieValue()).toBe('B');
});

it('removes the cookie when it is cleared', () => {
  render(
    <NavStyleProvider initialStyle="C">
      <Probe />
    </NavStyleProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pick A' }));
  clearNavStyleCookie();
  expect(cookieValue()).toBeUndefined();
});
