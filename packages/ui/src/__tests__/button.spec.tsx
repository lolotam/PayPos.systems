import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';

import { Button } from '../button.js';

const label = 'fixture.action';

it('renders children with the default variant and a non-submitting button type', () => {
  render(<Button>{label}</Button>);
  const button = screen.getByRole('button', { name: label });
  expect(button.classList.contains('bg-primary')).toBe(true);
  expect(button.classList.contains('min-h-12')).toBe(true);
  expect(button.getAttribute('type')).toBe('button');
});

it.each([
  ['default', 'bg-primary'],
  ['secondary', 'bg-secondary'],
  ['outline', 'border-input'],
  ['ghost', 'hover:bg-accent'],
  ['destructive', 'bg-destructive'],
] as const)('renders the %s variant', (variant, expected) => {
  render(<Button variant={variant}>{label}</Button>);
  expect(screen.getByRole('button').classList.contains(expected)).toBe(true);
});

it.each([
  ['sm', 'min-h-11'],
  ['md', 'min-h-12'],
  ['lg', 'min-h-14'],
  ['icon', 'size-11'],
] as const)('renders the %s size', (size, expected) => {
  render(<Button size={size} aria-label={label} />);
  expect(screen.getByRole('button').classList.contains(expected)).toBe(true);
});

it('preserves refs, overrides and disabled interaction', () => {
  const onClick = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  render(
    <Button ref={ref} disabled onClick={onClick} className="ps-8">
      {label}
    </Button>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).not.toHaveBeenCalled();
  expect(ref.current?.classList.contains('ps-8')).toBe(true);
  expect(ref.current?.classList.contains('ps-4')).toBe(false);
});

it('composes an anchor through the Radix slot without adding button semantics', () => {
  render(
    <Button asChild>
      <a href="#fixture">{label}</a>
    </Button>,
  );
  const link = screen.getByRole('link');
  expect(link.getAttribute('type')).toBeNull();
  expect(link.classList.contains('bg-primary')).toBe(true);
});

it('disables a slotted link: announced, out of the tab order, and its activation cancelled', () => {
  const onClick = vi.fn();
  render(
    <Button asChild disabled onClick={onClick}>
      <a href="#fixture">{label}</a>
    </Button>,
  );
  const link = screen.getByRole('link');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  expect({
    ariaDisabled: link.getAttribute('aria-disabled'),
    tabIndex: link.getAttribute('tabindex'),
    prevented: event.defaultPrevented,
    clicked: onClick.mock.calls.length,
  }).toEqual({ ariaDisabled: 'true', tabIndex: '-1', prevented: true, clicked: 0 });
});

it('keeps a slotted link that is not disabled fully actionable', () => {
  const onClick = vi.fn();
  render(
    <Button asChild onClick={onClick}>
      <a href="#fixture">{label}</a>
    </Button>,
  );
  fireEvent.click(screen.getByRole('link'));
  expect([
    screen.getByRole('link').getAttribute('aria-disabled'),
    onClick.mock.calls.length,
  ]).toEqual([null, 1]);
});

it('cancels a disabled slotted link before its own handlers run, and its tabIndex cannot win', () => {
  const childClick = vi.fn();
  render(
    <Button asChild disabled>
      <a href="#fixture" onClick={childClick} tabIndex={0}>
        {label}
      </a>
    </Button>,
  );
  const link = screen.getByRole('link');
  fireEvent.click(link);
  expect([childClick.mock.calls.length, link.getAttribute('tabindex')]).toEqual([0, '-1']);
});

it('forwards an explicit type to a slotted button, so it does not submit its form', () => {
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
  const { container } = render(
    <form>
      <Button asChild type="button">
        <button>{label}</button>
      </Button>
    </form>,
  );
  container.querySelector('form')?.addEventListener('submit', onSubmit);
  fireEvent.click(screen.getByRole('button'));
  expect([screen.getByRole('button').getAttribute('type'), onSubmit.mock.calls.length]).toEqual([
    'button',
    0,
  ]);
});
