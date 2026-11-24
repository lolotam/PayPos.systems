import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FilterRow } from './filter-row';

afterEach(cleanup);

it('lets filters wrap onto another line with a fixed horizontal and vertical gap', () => {
  render(
    <FilterRow data-testid="row">
      <div data-filter-field="">one</div>
      <div data-filter-field="">two</div>
    </FilterRow>,
  );
  const row = screen.getByTestId('row');
  expect(row.classList.contains('flex-wrap')).toBe(true);
  expect(row.classList.contains('gap-x-4')).toBe(true);
  expect(row.classList.contains('gap-y-3')).toBe(true);
  expect(row.querySelectorAll('[data-filter-field]')).toHaveLength(2);
});

it('keeps a caller class next to the built-in ones and does not drop the wrap', () => {
  render(<FilterRow data-testid="row" className="text-start" />);
  const row = screen.getByTestId('row');
  expect(row.classList.contains('text-start')).toBe(true);
  expect(row.classList.contains('flex-wrap')).toBe(true);
});
