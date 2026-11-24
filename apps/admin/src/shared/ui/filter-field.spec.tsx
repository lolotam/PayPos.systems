import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FilterField } from './filter-field';

afterEach(cleanup);

it('gives the field a definite width and a track that cannot grow past it', () => {
  render(<FilterField data-testid="field">one</FilterField>);
  const field = screen.getByTestId('field');
  expect(field.classList.contains('w-56')).toBe(true);
  expect(field.classList.contains('max-w-full')).toBe(true);
  expect(field.classList.contains('min-w-0')).toBe(true);
  expect(field.classList.contains('grid-cols-[minmax(0,1fr)]')).toBe(true);
});

it('lets the input and the select inside shrink to the field width', () => {
  render(
    <FilterField data-testid="field">
      <input aria-label="date" type="date" />
      <select aria-label="kind" />
    </FilterField>,
  );
  const classes = [...screen.getByTestId('field').classList];
  for (const tag of ['input', 'select']) {
    expect(classes).toContain(`[&_${tag}]:min-w-0`);
    expect(classes).toContain(`[&_${tag}]:max-w-full`);
  }
});

it('keeps a caller class next to the built-in ones', () => {
  render(<FilterField data-testid="field" className="text-start" />);
  const field = screen.getByTestId('field');
  expect(field.classList.contains('text-start')).toBe(true);
  expect(field.classList.contains('w-56')).toBe(true);
});
