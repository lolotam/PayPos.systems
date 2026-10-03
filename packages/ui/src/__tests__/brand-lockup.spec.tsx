import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrandLockup } from '../brand-lockup.js';

it.each([
  ['', 'ink', 'text-foreground'],
  ['dark', 'ink', 'text-foreground'],
  ['', 'light', 'text-sand-50'],
  ['dark', 'light', 'text-sand-50'],
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
    expect(lockup.querySelector('rect')?.getAttribute('fill')).toBe('#FF6421');
    expect(lockup.querySelector('path')?.getAttribute('fill')).toBe('#0D1522');
    expect(lockup.querySelector('circle')?.getAttribute('fill')).toBe('#F7F1E8');
  },
);
