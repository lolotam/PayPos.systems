import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrandLockup } from '../brand-lockup.js';
import { BrandMark } from '../brand-mark.js';

it.each([
  ['', 'ink', 'text-foreground'],
  ['dark', 'ink', 'text-foreground'],
  ['', 'sidebar', 'text-sidebar-foreground'],
  ['dark', 'sidebar', 'text-sidebar-foreground'],
] as const)(
  'keeps the %s theme %s wordmark readable without recolouring the tile',
  (theme, tone, colour) => {
    render(
      <div className={theme}>
        <BrandLockup
          title="fixture.brand"
          latinName="fixture.latin"
          arabicName="fixture.arabic"
          tone={tone}
        />
      </div>,
    );
    const lockup = screen.getByRole('img', { name: 'fixture.brand' });
    const wordmark = screen.getByText('fixture.latin').parentElement;
    expect(wordmark?.classList.contains(colour)).toBe(true);
    expect(wordmark?.classList.contains('text-ink-950')).toBe(false);
    const mark = lockup.querySelector('img');
    expect(mark?.getAttribute('src')).toBe('/brand/logo-mark-simple-tile.png');
    expect(mark?.getAttribute('alt')).toBe('');
  },
);

it('names the standalone mark with its title', () => {
  render(<BrandMark title="fixture.brand" />);
  const mark = screen.getByRole('img', { name: 'fixture.brand' });
  expect(mark.getAttribute('src')).toBe('/brand/logo-mark-simple-tile.png');
  expect(mark.getAttribute('width')).toBe('48');
  expect(mark.getAttribute('height')).toBe('48');
});

it('hides a decorative mark from the accessibility tree', () => {
  render(<BrandMark title="fixture.brand" aria-hidden="true" />);
  expect(screen.queryByRole('img', { name: 'fixture.brand' })).toBeNull();
  expect(screen.getByRole('presentation', { hidden: true }).getAttribute('alt')).toBe('');
});
