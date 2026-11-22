import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { HubCard } from '../hub-card.js';

const base = {
  id: 'team',
  label: 'Team hub',
  href: '#team',
  description: 'Employees, schedules and attendance in one place',
};

it('makes the whole card one link carrying icon, title and one line description', () => {
  const { container } = render(
    <DirectionProvider dir="rtl">
      <HubCard item={{ ...base, icon: <svg aria-hidden data-testid="hub-icon" /> }} />
    </DirectionProvider>,
  );
  const links = container.querySelectorAll('a');
  expect(links).toHaveLength(1);
  const link = links[0] as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('#team');
  expect(link.textContent).toContain('Team hub');
  expect(screen.getByText('Employees, schedules and attendance in one place')).toBeTruthy();
  expect(link.contains(screen.getByTestId('hub-icon'))).toBe(true);
});

it('shows the count and the Soon mark only when the caller supplies them', () => {
  const { container, rerender } = render(
    <DirectionProvider dir="rtl">
      <HubCard item={{ ...base, count: '7', status: 'Soon' }} />
    </DirectionProvider>,
  );
  expect(screen.getByText('7')).toBeTruthy();
  expect(screen.getByText('Soon')).toBeTruthy();

  rerender(
    <DirectionProvider dir="rtl">
      <HubCard item={base} />
    </DirectionProvider>,
  );
  expect(container.querySelector('[class*="bg-cta"]')).toBeNull();
  expect(screen.queryByText('Soon')).toBeNull();
});

it('keeps the description to one line with an ellipsis', () => {
  render(
    <DirectionProvider dir="ltr">
      <HubCard item={base} />
    </DirectionProvider>,
  );
  const description = screen.getByText(base.description);
  expect(description.className).toContain('truncate');
});

it('reports the choice to the caller while the card keeps its href', () => {
  const onNavigate = vi.fn();
  render(
    <DirectionProvider dir="ltr">
      <HubCard item={base} onNavigate={onNavigate} />
    </DirectionProvider>,
  );
  const link = screen.getByRole('link', { name: /Team hub/ });
  link.click();
  expect(onNavigate).toHaveBeenCalledWith(base);
});
