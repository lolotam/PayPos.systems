import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FilterField, FilterRow } from './filter-row';

afterEach(cleanup);

it('lets filters wrap onto another line with a fixed horizontal and vertical gap', () => {
  render(
    <FilterRow data-testid="row">
      <FilterField>one</FilterField>
      <FilterField>two</FilterField>
    </FilterRow>,
  );
  const row = screen.getByTestId('row');
  expect(row.classList.contains('flex-wrap')).toBe(true);
  expect(row.classList.contains('gap-x-4')).toBe(true);
  expect(row.classList.contains('gap-y-3')).toBe(true);
  expect(row.querySelectorAll('[data-filter-field]')).toHaveLength(2);
});

it('gives every field a definite width that can still shrink inside a narrow row', () => {
  render(<FilterField data-testid="field">one</FilterField>);
  const field = screen.getByTestId('field');
  expect(field.classList.contains('w-56')).toBe(true);
  expect(field.classList.contains('max-w-full')).toBe(true);
  expect(field.classList.contains('min-w-0')).toBe(true);
});

it('keeps a caller class next to the built-in ones and does not drop the wrap', () => {
  render(<FilterRow data-testid="row" className="text-start" />);
  const row = screen.getByTestId('row');
  expect(row.classList.contains('text-start')).toBe(true);
  expect(row.classList.contains('flex-wrap')).toBe(true);
});
