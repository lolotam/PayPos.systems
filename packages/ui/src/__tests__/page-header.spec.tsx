import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { PageHeader } from '../page-header.js';

it("keeps today's output for title, description and primary action", () => {
  render(
    <DirectionProvider dir="rtl">
      <PageHeader
        title="Services"
        description="One line lead"
        action={<button type="button">Add service</button>}
      />
    </DirectionProvider>,
  );
  const heading = screen.getByRole('heading', { name: 'Services' });
  expect(heading.className).toContain('text-2xl');
  expect(heading.className).toContain('font-bold');
  const description = screen.getByText('One line lead');
  expect(description.tagName).toBe('P');
  expect(description.className).toContain('text-sm');
  expect(description.className).toContain('text-muted-foreground');
  expect(screen.getByRole('button', { name: 'Add service' }).parentElement?.className).toContain(
    'ms-auto',
  );
});

it('renders secondary actions before the primary one with no gap when either is absent', () => {
  render(
    <DirectionProvider dir="ltr">
      <PageHeader
        title="Page"
        actions={
          <>
            <button type="button">Second</button>
            <button type="button">Third</button>
          </>
        }
        action={<button type="button">Primary</button>}
      />
    </DirectionProvider>,
  );
  const primary = screen.getByRole('button', { name: 'Primary' });
  const second = screen.getByRole('button', { name: 'Second' });
  expect(second.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('renders further actions alone without an empty primary slot', () => {
  render(
    <DirectionProvider dir="ltr">
      <PageHeader title="Page" description="Lead" actions={<button type="button">Second</button>} />
    </DirectionProvider>,
  );
  expect(screen.getByRole('button', { name: 'Second' })).toBeTruthy();
});

it('leaves no empty description or action gap', () => {
  const { container } = render(
    <DirectionProvider dir="ltr">
      <PageHeader title="Bare header" />
    </DirectionProvider>,
  );
  expect(container.querySelector('p')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Bare header' })).toBeTruthy();
});

// الغلاف لا ينكمش (shrink-0) فيحدّه max-w-full بعرض الترويسة، وإلا لا تلتف أزراره داخل شاشة ضيقة وتدفع الصفحة جانبًا.
it('caps the secondary-actions wrapper at the header width so its buttons can wrap', () => {
  render(
    <DirectionProvider dir="ltr">
      <PageHeader
        title="Page"
        actions={
          <>
            <button type="button">Second</button>
            <button type="button">Third</button>
          </>
        }
        action={<button type="button">Primary</button>}
      />
    </DirectionProvider>,
  );
  const wrapper = screen.getByRole('button', { name: 'Second' }).parentElement as HTMLElement;
  expect(wrapper.contains(screen.getByRole('button', { name: 'Third' }))).toBe(true);
  expect(wrapper.contains(screen.getByRole('button', { name: 'Primary' }))).toBe(false);
  const names = wrapper.className.split(' ');
  expect(names).toContain('max-w-full');
  expect(names).toContain('flex-wrap');
});

it('keeps the title block a basis of its own, so crowded actions wrap below it (#1234)', () => {
  render(
    <DirectionProvider dir="ltr">
      <PageHeader
        title="Employees"
        actions={<button type="button">Import employees</button>}
        action={<button type="button">Add employee</button>}
      />
    </DirectionProvider>,
  );
  const header = screen.getByRole('banner');
  const titleBlock = screen.getByRole('heading', { name: 'Employees' }).parentElement as HTMLElement;
  // jsdom does not lay out: this pins the structure; the real widths are checked in a browser.
  expect(header.className).toContain('flex-wrap');
  expect(titleBlock.className).toContain('flex-[1_1_14rem]');
  expect(titleBlock.className).not.toContain('flex-1 ');
});
