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
